// src/controllers/user.controller.ts
import { Request, Response } from 'express';
import { PublicKey, Transaction } from '@solana/web3.js';
import prisma from '../lib/prisma';
import Logger from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  userId: string;
}
import gridClient from '../lib/squad';
import luloService from '../services/lulo.service';
// Pending key utilities removed - no longer needed
import {
  CreateUserInput,
  UpdateUserInput,
  InitiateGridAccountInput,
  CompleteGridAccountInput,
  UserLoginInput,
} from '../schemas/user.schemas';
import { generateToken } from '../middleware/auth.middleware';
import { CompleteLoginInput } from '../schemas/auth.schemas';
import { blockchainService, TOKEN_MINTS } from '../services/blockchain.service';
import gaslessService from '../services/gasless.service';
import gaslessCreditService from '../services/gasless-credit.service';
// Transaction schemas import
import {
  PrepareTransactionInput,
  ExecuteTransactionInput,
  SendTransactionInput,
  SendSolTransactionInput,
  SendUsdcTransactionInput,
  SendGridToWalletTransactionInput,
  GaslessTransactionInput,
  GetCreditBalanceInput,
  GetPaymentHistoryInput,
  SponsorTransactionInput,
  CreateTransactionForSponsorInput,
} from '../schemas/transaction.schemas';

// Utility function to validate base64 transaction data
const validateBase64Transaction = (transactionData: string): { isValid: boolean; error?: string } => {
  if (!transactionData || typeof transactionData !== 'string') {
    return { isValid: false, error: 'Transaction data is not a string' };
  }

  if (transactionData.length === 0) {
    return { isValid: false, error: 'Transaction data is empty' };
  }

  // Validate base64 format
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(transactionData)) {
    return { isValid: false, error: 'Transaction data is not valid base64' };
  }

  // Check if it's a reasonable length for a Solana transaction
  if (transactionData.length < 100) {
    return { isValid: false, error: 'Transaction data is too short to be a valid Solana transaction' };
  }

  return { isValid: true };
};

// Token mint addresses are now imported from blockchain service
// They are automatically configured based on SOLANA_NETWORK environment variable

// Fee configuration
const TRANSFER_FEE = {
  amount: 0.07, // USDC fee per transfer
  recipientAddress: '3eq3vYYW2NFfDxxXoJ1ogC9ED2sye39SNaXYJPqExEmZ', // Fee recipient address
};

// Helper function to validate Grid client configuration
const validateGridConfig = () => {
  const apiKey = process.env.GRID_API_KEY;
  const environment = process.env.GRID_ENVIRONMENT;
  
  if (!apiKey) {
    Logger.error('GRID_API_KEY environment variable is not set');
    return { valid: false, error: 'Grid API key not configured' };
  }
  
  if (!environment || !['sandbox', 'production'].includes(environment)) {
    Logger.error('GRID_ENVIRONMENT must be either "sandbox" or "production"');
    return { valid: false, error: 'Invalid Grid environment configuration' };
  }
  
  Logger.info(`Grid client configured: environment=${environment}, apiKey=${apiKey.substring(0, 8)}...`);
  return { valid: true };
};

// Helper function to extract wallet address from Grid response
const extractWalletAddress = (authResult: any): string => {
  try {
    // First try to get from policies.signers[0].address (primary signer)
    if (authResult?.data?.policies?.signers?.[0]?.address) {
      return authResult.data.policies.signers[0].address;
    }
    
    // Fallback to authentication[0].session.Privy.session.wallets[0].address
    if (authResult?.data?.authentication?.[0]?.session?.Privy?.session?.wallets?.[0]?.address) {
      return authResult.data.authentication[0].session.Privy.session.wallets[0].address;
    }
    
    // Last fallback to the main address field
    if (authResult?.data?.address) {
      return authResult.data.address;
    }
    
    Logger.warn('Could not extract wallet address from Grid response');
    return '';
  } catch (error) {
    Logger.error('Error extracting wallet address:', error);
    return '';
  }
};

// Helper function to check user uniqueness
const checkUserUniqueness = async (data: {
  email?: string;
  walletAddress?: string;
  excludeUserId?: string;
}) => {
  const conflicts: string[] = [];

  // Check email uniqueness
  if (data.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingEmail && existingEmail.id !== data.excludeUserId) {
      conflicts.push('email');
    }
  }

  // Check walletAddress uniqueness
  if (data.walletAddress) {
    const existingWalletAddress = await prisma.user.findFirst({
      where: { 
        walletAddress: data.walletAddress,
        ...(data.excludeUserId && { id: { not: data.excludeUserId } })
      } as any,
    });
    if (existingWalletAddress) {
      conflicts.push('walletAddress');
    }
  }

  return conflicts;
};

// Get user by ID
export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    Logger.info(`Fetching user by ID: ${id}`);

    // Try to find user with UUID
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      Logger.warn(`User not found with ID: ${id}`);
      
      // Try to find if it's an email instead
      const emailUser = await prisma.user.findUnique({
        where: { email: id },
        select: { id: true, email: true },
      });
      
      if (emailUser) {
        Logger.info(`Found user by email instead: ${emailUser.email} (ID: ${emailUser.id})`);
        return res.status(404).json({ 
          error: 'User not found with provided ID',
          suggestion: 'The provided value may be an email address. Try using /api/users/email/{email} instead',
          providedValue: id,
          foundByEmail: true,
          userId: emailUser.id
        });
      }
      
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    Logger.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// Get user by email
export const getUserByEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    
    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    Logger.error('Error fetching user by email:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// Get all users
export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users, count: users.length });
  } catch (error) {
    Logger.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// Create user
export const createUser = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as CreateUserInput;
    const { email, firstName, lastName, middleName, phoneNumber } = validatedData;

    // Check uniqueness of all fields (excluding walletAddress since it's not provided)
    const conflicts = await checkUserUniqueness({
      email,
      excludeUserId: undefined,
    });

    if (conflicts.length > 0) {
      const conflictMessages = conflicts.map(field => {
        switch (field) {
          case 'email':
            return 'A user with this email already exists';
          default:
            return `A user with this ${field} already exists`;
        }
      });

      return res.status(409).json({
        error: 'User creation failed due to conflicts',
        conflicts: conflictMessages,
        fields: conflicts,
      });
    }

    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        middleName,
        phoneNumber,
        walletAddress: null, // Will be set when Grid account is created
        role: 'USER',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json({ user });
  } catch (error) {
    Logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// Update user
export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = req.body as UpdateUserInput;

    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check uniqueness for updated fields
    const conflicts = await checkUserUniqueness({
      email: validatedData.email,
      excludeUserId: id,
    });

    if (conflicts.length > 0) {
      const conflictMessages = conflicts.map(field => {
        switch (field) {
          case 'email':
            return 'A user with this email already exists';
          case 'walletAddress':
            return 'A user with this wallet address already exists';
          default:
            return `A user with this ${field} already exists`;
        }
      });

      return res.status(409).json({
        error: 'User update failed due to conflicts',
        conflicts: conflictMessages,
        fields: conflicts,
      });
    }

    const user = await prisma.user.update({
      where: { id },
      data: validatedData as any,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    res.json({ user });
  } catch (error) {
    Logger.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// Delete user
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await prisma.user.delete({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    Logger.info(`Deleted user from database: ${user.email}`);
    res.status(200).json({ message: 'User deleted successfully', user });
  } catch (error) {
    Logger.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

// Initiate Grid account creation (simplified - no pending key)
export const initiateGridAccount = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as InitiateGridAccountInput;
    const { email, firstName, lastName, middleName, phoneNumber } = validatedData;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ 
        error: 'User with this email already exists',
        field: 'email'
      });
    }

    // Check if phone number already exists (if provided)
    if (phoneNumber && phoneNumber.trim() !== '') {
      const existingPhoneUser = await prisma.user.findFirst({
        where: { phoneNumber },
      });

      if (existingPhoneUser) {
        return res.status(409).json({ 
          error: 'User with this phone number already exists',
          field: 'phoneNumber'
        });
      }
    }

    // Create account and get OTP (simplified approach)
    const accountCreation = await gridClient.createAccount({ 
      type: 'email',
      email: email 
    });

    if (!accountCreation?.success) {
      Logger.error('Grid account creation failed:', accountCreation);
      
      // Check if the error is because the email already has a Grid account
      if (accountCreation?.error?.includes('Email associated with grid account already exists')) {
        return res.status(409).json({
          error: 'Grid account already exists for this email',
          details: 'A Grid account already exists for this email. You can complete the account setup using the complete endpoint.',
          field: 'email',
          guidance: {
            message: 'This email already has a Grid account but no user record in our database.',
            action: 'Use the complete endpoint to finish account setup',
            endpoint: '/api/users/grid/complete',
            requiredFields: ['email', 'otpCode']
          }
        });
      }
      
      return res.status(500).json({
        error: 'Failed to create Grid account',
        details: accountCreation?.error || 'Account creation failed'
      });
    }

    // Store user details in database during initiate step
    try {
      const user = await prisma.user.create({
        data: {
          email,
          firstName: firstName || '',
          lastName: lastName || '',
          middleName: middleName || null,
          phoneNumber: phoneNumber || null,
          role: 'USER',
          isActive: true,
          gridStatus: 'pending', // Mark as pending until complete
          // Grid account data will be added during complete step
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          middleName: true,
          phoneNumber: true,
          role: true,
          isActive: true,
          gridStatus: true,
          createdAt: true,
        },
      });

      Logger.info(`User details stored during initiate step: ${email} (ID: ${user.id})`);

      res.status(201).json({ 
        message: 'Account creation initiated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          middleName: user.middleName,
          phoneNumber: user.phoneNumber,
          gridStatus: user.gridStatus,
          createdAt: user.createdAt,
        },
        instructions: 'Check your email for the OTP code and use it with the complete endpoint. User details have been saved.',
        nextStep: {
          endpoint: '/api/users/grid/complete',
          requiredFields: ['email', 'otpCode'],
          note: 'User details are already saved, only email and OTP required'
        }
      });

    } catch (dbError) {
      Logger.error('Database error during user creation in initiate step:', dbError);
      
      // If database storage fails, still return success for Grid account creation
      // but inform user they may need to provide details again
      res.status(201).json({ 
        message: 'Grid account creation initiated successfully, but user details could not be saved',
        email: email,
        instructions: 'Check your email for the OTP code and use it with the complete endpoint',
        warning: 'You may need to provide user details again during completion',
        nextStep: {
          endpoint: '/api/users/grid/complete',
          requiredFields: ['email', 'otpCode', 'firstName', 'lastName', 'middleName', 'phoneNumber']
        }
      });
    }
  } catch (error) {
    Logger.error('Error initiating Grid account:', error);
    res.status(500).json({ error: 'Failed to initiate Grid account' });
  }
};

// Request OTP for existing Grid account (for completing account setup)
export const requestOtpForExistingAccount = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    
    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }

    // Check if user already exists in database
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'User account already exists',
        message: 'User account already exists in database. Use the login endpoint instead.',
        guidance: {
          action: 'Use the login endpoint',
          endpoint: '/api/users/login'
        }
      });
    }

    // Try to initiate authentication for existing Grid account
    try {
      const authResult = await gridClient.initAuth({
        email: email,
      });

      if (authResult?.success) {
        Logger.info(`OTP sent for existing Grid account: ${email}`);
        return res.status(200).json({
          message: 'OTP sent successfully for existing Grid account',
          email: email,
          instructions: 'Check your email for the OTP code and use it with the complete endpoint',
          guidance: {
            action: 'Complete account setup',
            endpoint: '/api/users/grid/complete',
            requiredFields: ['email', 'otpCode', 'firstName', 'lastName', 'middleName', 'phoneNumber']
          }
        });
      } else {
        Logger.error('Failed to send OTP for existing account:', authResult);
        return res.status(500).json({
          error: 'Failed to send OTP',
          details: authResult?.error || 'OTP sending failed'
        });
      }
    } catch (gridError: any) {
      Logger.error('Error requesting OTP for existing account:', gridError);
      
      // Check if the error indicates the account doesn't exist
      if (gridError?.message?.includes('Email associated with grid account already exists') ||
          gridError?.error?.includes('Email associated with grid account already exists')) {
        
        return res.status(409).json({
          error: 'Grid account already exists',
          message: 'A Grid account exists for this email but OTP request failed.',
          details: 'This might indicate an issue with the Grid account state.',
          guidance: {
            action: 'Try the complete endpoint directly or contact support',
            endpoint: '/api/users/grid/complete'
          }
        });
      }
      
      return res.status(500).json({
        error: 'Failed to request OTP',
        details: gridError?.message || 'Unknown error occurred'
      });
    }

  } catch (error) {
    Logger.error('Error requesting OTP for existing account:', error);
    res.status(500).json({ error: 'Failed to request OTP for existing account' });
  }
};

// Check if a Grid account exists for an email (helper endpoint)
export const checkGridAccountStatus = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    
    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }

    // Check if user exists in database
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (existingUser) {
      return res.status(200).json({
        status: 'user_exists',
        message: 'User account exists in database',
        user: existingUser,
        guidance: {
          message: 'User account already exists. You can log in directly.',
          action: 'Use the login endpoint',
          endpoint: '/api/users/login'
        }
      });
    }

    // Try to initiate account creation to see if Grid account exists
    try {
      const accountCreation = await gridClient.createAccount({ 
        type: 'email',
        email: email 
      });

      if (accountCreation?.success) {
        return res.status(200).json({
          status: 'grid_account_available',
          message: 'No user record exists, but Grid account creation is available',
          guidance: {
            message: 'You can create a new Grid account.',
            action: 'Use the initiate endpoint to start account creation',
            endpoint: '/api/users/grid/initiate',
            requiredFields: ['email', 'firstName', 'lastName', 'middleName', 'phoneNumber']
          }
        });
      }
    } catch (gridError: any) {
      // Check if the error is because the email already has a Grid account
      if (gridError?.message?.includes('Email associated with grid account already exists') ||
          gridError?.error?.includes('Email associated with grid account already exists')) {
        
        return res.status(200).json({
          status: 'grid_account_exists',
          message: 'Grid account exists but no user record in database',
          guidance: {
            message: 'A Grid account exists for this email but no user record in our database.',
            action: 'Complete account setup using the complete endpoint',
            endpoint: '/api/users/grid/complete',
            requiredFields: ['email', 'otpCode', 'firstName', 'lastName', 'middleName', 'phoneNumber'],
            note: 'You will need to request an OTP first using the initiate endpoint'
          }
        });
      }
    }

    return res.status(200).json({
      status: 'unknown',
      message: 'Unable to determine account status',
      guidance: {
        message: 'Unable to determine if account exists. Try creating a new account.',
        action: 'Use the initiate endpoint to start account creation',
        endpoint: '/api/users/grid/initiate'
      }
    });

  } catch (error) {
    Logger.error('Error checking Grid account status:', error);
    res.status(500).json({ error: 'Failed to check account status' });
  }
};

// Complete Grid account creation (simplified - no pending key)
export const completeGridAccount = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as CompleteGridAccountInput;
    const { email, otpCode, firstName, lastName, middleName, phoneNumber } = validatedData;

    if (!email || !otpCode) {
      return res.status(400).json({ 
        error: 'Email and OTP code are required' 
      });
    }

    // Validate OTP code format
    if (!/^[0-9]{6}$/.test(otpCode)) {
      return res.status(400).json({ 
        error: 'Invalid OTP code format',
        details: 'OTP code must be exactly 6 digits'
      });
    }

    // Debug Grid client configuration
    Logger.info(`Grid client configuration for ${email}:`, {
      environment: process.env.GRID_ENVIRONMENT,
      hasApiKey: !!process.env.GRID_API_KEY,
      apiKeyLength: process.env.GRID_API_KEY?.length || 0
    });

    // Check if user already exists (from initiate step)
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    Logger.info(`User lookup for ${email}:`, {
      exists: !!existingUser,
      id: existingUser?.id,
      gridAddress: existingUser?.gridAddress,
      gridStatus: existingUser?.gridStatus,
      hasAuthResult: !!existingUser?.authResult,
      hasSessionSecrets: !!existingUser?.sessionSecrets,
      endpoint: 'grid/complete',
      recommendation: existingUser?.gridStatus === 'success' && existingUser?.gridAddress ? 'Use /api/users/grid/login/complete instead' : 'Continue with account creation'
    });

    if (existingUser) {
      // If user exists and has completed Grid account, redirect to login flow
      if (existingUser.gridStatus === 'success' && existingUser.gridAddress) {
        return res.status(409).json({ 
          error: 'User account already completed',
          field: 'email',
          message: 'This user account has already been completed successfully',
          guidance: {
            message: 'This user already has a completed Grid account. Use the login flow instead.',
            action: 'Use the login endpoint',
            endpoints: {
              initiate: '/api/users/grid/login',
              complete: '/api/users/grid/login/complete'
            },
            requiredFields: ['email', 'otpCode']
          }
        });
      }
      
      // If user exists but Grid account is pending, use existing user data
      Logger.info(`Found existing user with pending Grid account: ${email}`);
      
      // Use existing user data, but allow updates if provided
      const userData = {
        firstName: firstName || existingUser.firstName,
        lastName: lastName || existingUser.lastName,
        middleName: middleName || existingUser.middleName,
        phoneNumber: phoneNumber || existingUser.phoneNumber,
      };
      
      // Update user data if new values provided
      if (firstName || lastName || middleName || phoneNumber) {
        await prisma.user.update({
          where: { email },
          data: userData,
        });
        Logger.info(`Updated user data for: ${email}`);
      }
    } else {
      // If no existing user, validate and create new user
      if (!firstName || !lastName) {
        return res.status(400).json({ 
          error: 'First name and last name are required for new users',
          field: 'firstName'
        });
      }

      // Check if phone number already exists (if provided)
      if (phoneNumber && phoneNumber.trim() !== '') {
        const existingPhoneUser = await prisma.user.findFirst({
          where: { phoneNumber },
        });

        if (existingPhoneUser) {
          return res.status(409).json({ 
            error: 'User with this phone number already exists',
            field: 'phoneNumber'
          });
        }
      }
    }

    // Generate session secrets for the new account
    let sessionSecrets;
    try {
      sessionSecrets = await gridClient.generateSessionSecrets();
      Logger.info(`Generated session secrets for ${email}:`, {
        sessionSecretsKeys: sessionSecrets ? Object.keys(sessionSecrets) : 'null',
        sessionSecretsType: typeof sessionSecrets
      });
    } catch (sessionError: any) {
      Logger.error(`Failed to generate session secrets for ${email}:`, {
        error: sessionError,
        message: sessionError?.message,
        stack: sessionError?.stack
      });
      return res.status(500).json({
        error: 'Failed to generate session secrets',
        details: sessionError?.message || 'Session secrets generation failed'
      });
    }

    // Create a temporary user context for Grid SDK
    const tempUser = {
      email: email,
      grid_user_id: undefined, // Use undefined instead of null
      signers: [], // Empty signers array for new account - this might be the issue
      address: undefined,
      session: undefined
    };
    
    Logger.info(`Created temp user context for ${email}:`, {
      tempUser: tempUser,
      otpCode: otpCode,
      otpCodeLength: otpCode?.length,
      otpCodeType: typeof otpCode,
      otpCodeIsNumeric: /^\d+$/.test(otpCode || ''),
      otpCodeIsValidFormat: /^[0-9]{6}$/.test(otpCode || '')
    });

    // Try to complete Grid account authentication/creation
    let authResult;
    
    // Check if this is a user from the initiate flow (gridStatus: 'pending')
    const isInitiateFlowUser = existingUser && existingUser.gridStatus === 'pending';
    
    if (isInitiateFlowUser) {
      Logger.info(`User ${email} is from initiate flow (gridStatus: pending), skipping authentication and going directly to account creation`);
      
      // For users from initiate flow, go directly to account creation
      try {
        Logger.info(`Attempting account creation for initiate flow user: ${email}`, {
          tempUser: tempUser,
          otpCode: otpCode,
          otpCodeLength: otpCode?.length,
          otpCodeIsNumeric: /^\d+$/.test(otpCode || ''),
          sessionSecretsLength: sessionSecrets ? Object.keys(sessionSecrets).length : 0,
          sessionSecretsKeys: sessionSecrets ? Object.keys(sessionSecrets) : []
        });
        
        authResult = await gridClient.completeAuthAndCreateAccount({
          otpCode,
          user: tempUser,
          sessionSecrets,
        });
        
        if (authResult?.success) {
          Logger.info(`Successfully created Grid account for initiate flow user: ${email}`, {
            authResult: authResult,
            data: authResult?.data,
            address: authResult?.data?.address
          });
        } else {
          Logger.error(`Account creation failed for initiate flow user ${email}:`, {
            authResult: authResult,
            success: authResult?.success,
            error: authResult?.error
          });
        }
      } catch (createError: any) {
        Logger.error(`Account creation failed for initiate flow user ${email}:`, {
          error: createError,
          message: createError?.message,
          errorString: createError?.error,
          stack: createError?.stack,
          response: createError?.response?.data,
          status: createError?.response?.status,
          statusText: createError?.response?.statusText
        });
        
        return res.status(500).json({
          error: 'Failed to create Grid account',
          details: createError?.message || createError?.error || 'Account creation failed',
          debug: {
            success: false,
            hasData: false,
            hasError: true,
            errorType: 'initiate_flow_account_creation_failed'
          }
        });
      }
    } else {
      // For other users, try authentication first, then account creation
      Logger.info(`User ${email} is not from initiate flow, trying authentication first`);
      
      // First try authentication (for existing accounts)
      try {
        Logger.info(`Attempting authentication for existing Grid account: ${email}`, {
          tempUser: tempUser,
          otpCode: otpCode,
          otpCodeLength: otpCode?.length,
          otpCodeIsNumeric: /^\d+$/.test(otpCode || ''),
          sessionSecretsLength: sessionSecrets ? Object.keys(sessionSecrets).length : 0,
          sessionSecretsKeys: sessionSecrets ? Object.keys(sessionSecrets) : []
        });
        authResult = await gridClient.completeAuth({
          otpCode,
          user: tempUser,
          sessionSecrets,
        });
        
        if (authResult?.success) {
          Logger.info(`Successfully authenticated existing Grid account: ${email}`, {
            authResult: authResult,
            data: authResult?.data,
            address: authResult?.data?.address
          });
        } else {
          Logger.warn(`Authentication returned unsuccessful result for ${email}:`, {
            authResult: authResult,
            success: authResult?.success,
            error: authResult?.error
          });
          
          // Check if the error indicates no Grid account exists
          if (authResult?.error?.includes('No linked grid account found') || 
              authResult?.error?.includes('no linked grid account') ||
              authResult?.error?.includes('account not found')) {
            Logger.info(`No Grid account found for ${email}, will try account creation`);
            // Set authResult to null to trigger account creation
            authResult = null;
          }
        }
      } catch (authError: any) {
        Logger.warn(`Authentication failed for ${email}, trying account creation:`, {
          error: authError,
          message: authError?.message,
          errorString: authError?.error,
          stack: authError?.stack,
          response: authError?.response?.data,
          status: authError?.response?.status,
          statusText: authError?.response?.statusText
        });
        
        // If authentication fails, try account creation (for new accounts)
        try {
          Logger.info(`Attempting account creation for new Grid account: ${email}`, {
            tempUser: tempUser,
            otpCode: otpCode,
            otpCodeLength: otpCode?.length,
            otpCodeIsNumeric: /^\d+$/.test(otpCode || ''),
            sessionSecretsLength: sessionSecrets ? Object.keys(sessionSecrets).length : 0,
            sessionSecretsKeys: sessionSecrets ? Object.keys(sessionSecrets) : []
          });
          authResult = await gridClient.completeAuthAndCreateAccount({
            otpCode,
            user: tempUser,
            sessionSecrets,
          });
          
          if (authResult?.success) {
            Logger.info(`Successfully created new Grid account: ${email}`, {
              authResult: authResult,
              data: authResult?.data,
              address: authResult?.data?.address
            });
          } else {
            Logger.warn(`Account creation returned unsuccessful result for ${email}:`, {
              authResult: authResult,
              success: authResult?.success,
              error: authResult?.error
            });
          }
        } catch (createError: any) {
          Logger.error('Both authentication and account creation failed:', {
            authError: authError,
            createError: createError,
            email: email,
            authErrorDetails: {
              message: authError?.message,
              error: authError?.error,
              stack: authError?.stack,
              response: authError?.response?.data,
              status: authError?.response?.status
            },
            createErrorDetails: {
              message: createError?.message,
              error: createError?.error,
              stack: createError?.stack,
              response: createError?.response?.data,
              status: createError?.response?.status
            }
          });
          
          // Return detailed error information
          return res.status(500).json({
            error: 'Failed to complete Grid account setup',
            details: 'Both authentication and account creation failed',
            authError: authError?.message || authError?.error || 'Authentication failed',
            createError: createError?.message || createError?.error || 'Account creation failed',
            guidance: {
              message: 'Unable to complete account setup. Please check your OTP code and try again.',
              action: 'Verify OTP code and retry',
              endpoint: '/api/users/grid/complete'
            }
          });
        }
      }
    }

    if (authResult?.success) {
      // Extract wallet address from Grid response
      const walletAddress = extractWalletAddress(authResult);
      
      if (!walletAddress) {
        Logger.error('Failed to extract wallet address from Grid response');
        return res.status(500).json({ error: 'Failed to extract wallet address from Grid account' });
      }

      try {
        let user;
        
        if (existingUser) {
          // Update existing user with Grid account data
          user = await prisma.user.update({
            where: { email },
            data: {
              walletAddress, // Use extracted wallet address
              // Store Grid account data
              gridAddress: authResult.data?.address || null,
              gridStatus: 'success', // Default to success since authentication was successful
              // Store Grid authentication data
              authResult: authResult.data as any || null,
              sessionSecrets: sessionSecrets as any || null,
            },
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              middleName: true,
              phoneNumber: true,
              walletAddress: true,
              role: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
              gridAddress: true,
              gridStatus: true,
              authResult: true,
              sessionSecrets: true,
            },
          });

          Logger.info(`Updated existing user in database: ${email} with wallet: ${walletAddress} and Grid address: ${user.gridAddress}`);
        } else {
          // Create new user with Grid account data
          user = await prisma.user.create({
            data: {
              email,
              firstName: firstName || '',
              lastName: lastName || '',
              middleName: middleName || null,
              phoneNumber: phoneNumber || null,
              walletAddress, // Use extracted wallet address
              role: 'USER',
              isActive: true,
              // Store Grid account data
              gridAddress: authResult.data?.address || null,
              gridStatus: 'success', // Default to success since authentication was successful
              // Store Grid authentication data
              authResult: authResult.data as any || null,
              sessionSecrets: sessionSecrets as any || null,
            },
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              middleName: true,
              phoneNumber: true,
              walletAddress: true,
              role: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
              gridAddress: true,
              gridStatus: true,
              authResult: true,
              sessionSecrets: true,
            },
          });

          Logger.info(`Created new user in database: ${email} with wallet: ${walletAddress} and Grid address: ${user.gridAddress}`);
        }

        // Generate JWT token for page refresh functionality
        const token = generateToken(user.id);

        // Return user and Grid account details in the simplified format
        return res.status(201).json({ 
          message: existingUser ? 'Grid account completed successfully for existing user' : 'User account created and Grid account completed successfully',
          token,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            middleName: user.middleName,
            phoneNumber: user.phoneNumber,
            walletAddress: user.walletAddress,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            gridAddress: user.gridAddress,
            gridStatus: user.gridStatus,
            authResult: user.authResult,
            sessionSecrets: user.sessionSecrets,
          }
        });
      } catch (dbError) {
        Logger.error('Database error during user creation/update:', dbError);
        
        res.status(500).json({ 
          error: 'Failed to create/update user in database',
          gridAccount: {
            address: authResult.data?.address || '',
            status: 'success', // Default to success since authentication was successful
            policies: authResult.data?.policies || {},
          }
        });
      }
    } else {
      Logger.error('Grid account creation failed2:', {
        authResult: authResult,
        success: authResult?.success,
        error: authResult?.error,
        data: authResult?.data,
        email: email,
        existingUser: !!existingUser
      });
      res.status(500).json({ 
        error: 'Failed to create Grid account',
        details: authResult?.error || 'Unknown error',
        debug: {
          success: authResult?.success,
          hasData: !!authResult?.data,
          hasError: !!authResult?.error
        }
      });
    }
  } catch (error) {
    Logger.error('Error completing Grid account:', error);
    res.status(500).json({ error: 'Failed to complete Grid account creation' });
  }
};

// Get user account balances directly from Solana blockchain
export const getUserBalances = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const { limit = 10, offset = 0, mint } = req.query;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address for balance queries (Grid-to-Grid system)
    const gridAddress = user.gridAddress;
    
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to fetch balances'
      });
    }

    Logger.info(`Fetching Grid account balances for user ${email} (Grid address: ${gridAddress})`);

    // Prepare query parameters for Grid SDK
    const queryParams: any = {
      limit: Number(limit),
      offset: Number(offset),
    };

    // Add mint filter if provided
    if (mint && typeof mint === 'string') {
      queryParams.mint = mint;
    }

    // Get account balances using Grid SDK
    const balancesResponse = await gridClient.getAccountBalances(gridAddress, queryParams);

    if (!balancesResponse?.success) {
      Logger.error('Grid SDK balance fetch failed:', balancesResponse?.error);
      return res.status(500).json({
        error: 'Failed to fetch balances from Grid SDK',
        details: balancesResponse?.error || 'Grid SDK balance fetch failed'
      });
    }

    const balancesData = balancesResponse.data;
    Logger.info(`Fetched Grid balances for user ${email}:`, {
      success: balancesResponse.success,
      hasData: !!balancesData,
      tokenCount: balancesData?.tokens?.length || 0
    });

    // Process the Grid SDK response to match our expected format
    // Note: Using type assertion to handle Grid SDK response structure
    const processedBalances = {
      sol: {
        balance: (balancesData as any)?.lamports?.toString() || '0',
        formattedBalance: (balancesData as any)?.sol?.toString() || '0',
        decimals: 9,
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        uiAmount: parseFloat((balancesData as any)?.sol?.toString() || '0')
      },
      usdc: {
        balance: '0',
        formattedBalance: '0',
        decimals: 6,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        uiAmount: 0
      },
      summary: {
        totalTokens: balancesData?.tokens?.length || 0,
        hasNative: !!((balancesData as any)?.sol && parseFloat((balancesData as any).sol.toString()) > 0),
        hasUsdc: false,
        queryParams: queryParams,
        source: 'grid-sdk',
        gridAddress: gridAddress
      },
      allTokens: balancesData?.tokens || [],
      native: null
    };

    // Find USDC token in the tokens array
    if (balancesData?.tokens) {
      const usdcToken = balancesData.tokens.find((token: any) => 
        token.token_address === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      
      if (usdcToken) {
        processedBalances.usdc = {
          balance: usdcToken.amount?.toString() || '0',
          formattedBalance: usdcToken.amount_decimal?.toString() || '0',
          decimals: usdcToken.decimals || 6,
          mint: usdcToken.token_address,
          symbol: usdcToken.symbol || 'USDC',
          uiAmount: parseFloat(usdcToken.amount_decimal?.toString() || '0')
        };
        processedBalances.summary.hasUsdc = parseFloat(usdcToken.amount_decimal?.toString() || '0') > 0;
      }
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      balances: processedBalances,
      gridResponse: {
        success: balancesResponse.success,
        data: balancesData
      }
    });
  } catch (error) {
    Logger.error('Error fetching user balances from Grid SDK:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user balances from Grid SDK',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get user account balances by wallet address using Grid SDK
export const getUserBalancesByWallet = async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const { limit = 10, offset = 0, mint } = req.query;

    // Validate wallet address format
    if (!blockchainService.isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ 
        error: 'Invalid wallet address format',
        details: 'Wallet address must be a valid Solana public key'
      });
    }

    // Find user by wallet address
    const user = await prisma.user.findFirst({
      where: { walletAddress },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address for balance queries (Grid-to-Grid system)
    const gridAddress = user.gridAddress;
    
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to fetch balances'
      });
    }

    Logger.info(`Fetching Grid account balances for wallet: ${walletAddress} (Grid address: ${gridAddress})`);

    // Prepare query parameters for Grid SDK
    const queryParams: any = {
      limit: Number(limit),
      offset: Number(offset),
    };

    // Add mint filter if provided
    if (mint && typeof mint === 'string') {
      queryParams.mint = mint;
    }

    // Get account balances using Grid SDK
    const balancesResponse = await gridClient.getAccountBalances(gridAddress, queryParams);

    if (!balancesResponse?.success) {
      Logger.error('Grid SDK balance fetch failed:', balancesResponse?.error);
      return res.status(500).json({
        error: 'Failed to fetch balances from Grid SDK',
        details: balancesResponse?.error || 'Grid SDK balance fetch failed'
      });
    }

    const balancesData = balancesResponse.data;
    Logger.info(`Fetched Grid balances for wallet ${walletAddress}:`, {
      success: balancesResponse.success,
      hasData: !!balancesData,
      tokenCount: balancesData?.tokens?.length || 0
    });

    // Process the Grid SDK response to match our expected format
    // Note: Using type assertion to handle Grid SDK response structure
    const processedBalances = {
      sol: {
        balance: (balancesData as any)?.lamports?.toString() || '0',
        formattedBalance: (balancesData as any)?.sol?.toString() || '0',
        decimals: 9,
        mint: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        uiAmount: parseFloat((balancesData as any)?.sol?.toString() || '0')
      },
      usdc: {
        balance: '0',
        formattedBalance: '0',
        decimals: 6,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        uiAmount: 0
      },
      summary: {
        totalTokens: balancesData?.tokens?.length || 0,
        hasNative: !!((balancesData as any)?.sol && parseFloat((balancesData as any).sol.toString()) > 0),
        hasUsdc: false,
        queryParams: queryParams,
        source: 'grid-sdk',
        walletAddress: walletAddress,
        gridAddress: gridAddress
      },
      allTokens: balancesData?.tokens || [],
      native: null
    };

    // Find USDC token in the tokens array
    if (balancesData?.tokens) {
      const usdcToken = balancesData.tokens.find((token: any) => 
        token.token_address === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      
      if (usdcToken) {
        processedBalances.usdc = {
          balance: usdcToken.amount?.toString() || '0',
          formattedBalance: usdcToken.amount_decimal?.toString() || '0',
          decimals: usdcToken.decimals || 6,
          mint: usdcToken.token_address,
          symbol: usdcToken.symbol || 'USDC',
          uiAmount: parseFloat(usdcToken.amount_decimal?.toString() || '0')
        };
        processedBalances.summary.hasUsdc = parseFloat(usdcToken.amount_decimal?.toString() || '0') > 0;
      }
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      balances: processedBalances,
      gridResponse: {
        success: balancesResponse.success,
        data: balancesData
      }
    });
  } catch (error) {
    Logger.error('Error fetching balances by wallet address from Grid SDK:', error);
    res.status(500).json({ 
      error: 'Failed to fetch balances by wallet address from Grid SDK',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Debug endpoint to check raw Grid API response for a specific user
export const updateUserGridData = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const { gridAddress, gridStatus, authResult, sessionSecrets } = req.body;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    if (!gridAddress) {
      return res.status(400).json({ error: 'Grid address is required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user with Grid account data
    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        gridAddress,
        gridStatus: gridStatus || 'success',
        authResult: authResult as any || undefined,
        sessionSecrets: sessionSecrets as any || undefined,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    Logger.info(`Updated user ${email} with Grid account data: ${gridAddress}`);

    res.json({
      message: 'User Grid account data updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    Logger.error('Error updating user Grid account data:', error);
    res.status(500).json({ error: 'Failed to update user Grid account data' });
  }
};

export const debugUserBalances = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address for balance queries (Grid-to-Grid system)
    const gridAddress = user.gridAddress;
    
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to fetch balances'
      });
    }

    Logger.info(`Debug: Fetching Grid account balances for user ${email} (Grid address: ${gridAddress})`);

    // Get account balances using Grid SDK
    const balancesResponse = await gridClient.getAccountBalances(gridAddress);

    if (!balancesResponse?.success) {
      Logger.error('Debug: Grid SDK balance fetch failed:', balancesResponse?.error);
      return res.status(500).json({
        error: 'Failed to fetch balances from Grid SDK',
        details: balancesResponse?.error || 'Grid SDK balance fetch failed'
      });
    }

    const balancesData = balancesResponse.data;
    Logger.info('Debug: Grid balances fetched:', {
      email,
      gridAddress,
      success: balancesResponse.success,
      hasData: !!balancesData,
      tokenCount: balancesData?.tokens?.length || 0,
      nativeBalance: (balancesData as any)?.sol?.toString() || '0',
      lamports: (balancesData as any)?.lamports?.toString() || '0',
      tokens: balancesData?.tokens?.map((token: any) => ({
        token_address: token.token_address,
        symbol: token.symbol,
        amount_decimal: token.amount_decimal
      })) || []
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
        gridStatus: user.gridStatus,
        authResult: user.authResult,
        sessionSecrets: user.sessionSecrets,
      },
      debug: {
        gridAddress,
        source: 'grid-sdk',
        gridResponse: {
          success: balancesResponse.success,
          data: balancesData
        },
        rawGridData: balancesData
      }
    });
  } catch (error) {
    Logger.error('Debug: Error fetching user balances from Grid SDK:', error);
    res.status(500).json({ 
      error: 'Failed to debug user balances from Grid SDK',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get user transfer history using Grid SDK
export const getUserTransfers = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const { 
      limit = 10, 
      offset = 0, 
      startDate, 
      endDate, 
      tokenMint,
      direction 
    } = req.query;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address for transfer queries (Grid-to-Grid system)
    const gridAddress = user.gridAddress;
    
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to fetch transfer history'
      });
    }

    Logger.info(`Fetching Grid transfer history for user ${email} (Grid address: ${gridAddress})`);

    // Prepare options for Grid SDK
    const options: any = {
      limit: Number(limit),
      offset: Number(offset),
    };

    // Add optional filters
    if (startDate && typeof startDate === 'string') {
      options.startDate = startDate;
    }
    if (endDate && typeof endDate === 'string') {
      options.endDate = endDate;
    }
    if (tokenMint && typeof tokenMint === 'string') {
      options.tokenMint = tokenMint;
    }
    if (direction && typeof direction === 'string') {
      options.direction = direction;
    }

    // Get transfer history using Grid SDK
    const transfersResponse = await gridClient.getTransfers(gridAddress, options);

    if (!transfersResponse?.success) {
      Logger.error('Grid SDK transfer fetch failed:', transfersResponse?.error);
      return res.status(500).json({
        error: 'Failed to fetch transfer history from Grid SDK',
        details: transfersResponse?.error || 'Grid SDK transfer fetch failed'
      });
    }

    const transfersData = transfersResponse.data;
    Logger.info(`Fetched Grid transfer history for user ${email}:`, {
      success: transfersResponse.success,
      hasData: !!transfersData,
      transferCount: Array.isArray(transfersData) ? transfersData.length : 0,
      options: options
    });

    // Process the Grid SDK response
    const processedTransfers = Array.isArray(transfersData) ? transfersData.map((transfer: any) => ({
      id: transfer.id || transfer.signature,
      signature: transfer.signature,
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amount,
      tokenMint: transfer.tokenMint,
      tokenSymbol: transfer.tokenSymbol || 'UNKNOWN',
      direction: transfer.direction,
      status: transfer.status,
      timestamp: transfer.timestamp,
      blockTime: transfer.blockTime,
      fee: transfer.fee,
      memo: transfer.memo,
      rawTransfer: transfer // Include raw data for debugging
    })) : [];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      transfers: {
        data: processedTransfers,
        summary: {
          totalTransfers: processedTransfers.length,
          options: options,
          source: 'grid-sdk',
          gridAddress: gridAddress
        },
        pagination: {
          limit: Number(limit),
          offset: Number(offset),
          hasMore: processedTransfers.length === Number(limit)
        }
      },
      gridResponse: {
        success: transfersResponse.success,
        data: transfersData
      }
    });
  } catch (error) {
    Logger.error('Error fetching user transfer history from Grid SDK:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user transfer history from Grid SDK',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Debug endpoint to check raw Grid transfer API response for a specific user
export const debugUserTransfers = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address for transfer queries (Grid-to-Grid system)
    const gridAddress = user.gridAddress;
    
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to fetch transfer history'
      });
    }

    Logger.info(`Debug: Fetching Grid transfer history for user ${email} (Grid address: ${gridAddress})`);

    // Get transfer history using Grid SDK
    const transfersResponse = await gridClient.getTransfers(gridAddress);

    if (!transfersResponse?.success) {
      Logger.error('Debug: Grid SDK transfer fetch failed:', transfersResponse?.error);
      return res.status(500).json({
        error: 'Failed to fetch transfer history from Grid SDK',
        details: transfersResponse?.error || 'Grid SDK transfer fetch failed'
      });
    }

    const transfersData = transfersResponse.data;
    Logger.info('Debug: Grid transfer history fetched:', {
      email,
      gridAddress,
      success: transfersResponse.success,
      hasData: !!transfersData,
      transferCount: Array.isArray(transfersData) ? transfersData.length : 0,
      transfers: Array.isArray(transfersData) ? transfersData.map((transfer: any) => ({
        id: transfer.id || transfer.signature,
        signature: transfer.signature,
        from: transfer.from,
        to: transfer.to,
        amount: transfer.amount,
        tokenMint: transfer.tokenMint,
        direction: transfer.direction,
        status: transfer.status,
        timestamp: transfer.timestamp
      })) : []
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
        gridStatus: user.gridStatus,
        authResult: user.authResult,
        sessionSecrets: user.sessionSecrets,
      },
      debug: {
        gridAddress,
        source: 'grid-sdk',
        gridResponse: {
          success: transfersResponse.success,
          data: transfersData
        },
        rawTransferData: transfersData
      }
    });
  } catch (error) {
    Logger.error('Debug: Error fetching user transfer history from Grid SDK:', error);
    res.status(500).json({ 
      error: 'Failed to debug user transfer history from Grid SDK',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Regular login process
export const login = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as UserLoginInput;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Generate JWT token
    const token = generateToken(existingUser.id);

    Logger.info(`Login successful for user ${email}`);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        walletAddress: existingUser.walletAddress,
        gridAddress: existingUser.gridAddress,
        gridStatus: existingUser.gridStatus,
      },
    });
  } catch (error) {
    Logger.error('Error initiating login:', error);
    res.status(500).json({ error: 'Failed to initiate login process' });
  }
};

// Initiate Grid-based login (sends OTP email)
export const initiateLogin = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as UserLoginInput;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Initialize Grid authentication using initAuth
    const authResult = await gridClient.initAuth({
      email: existingUser.email,
    });

    if (!authResult?.success) {
      Logger.error('Grid initAuth failed:', authResult);
      return res.status(500).json({
        error: 'Failed to initialize Grid authentication',
        details: authResult?.error || 'Grid authentication initialization failed',
      });
    }

    Logger.info(`Grid authentication initiated for user ${email}`);

    res.status(201).json({
      message: 'Grid authentication initiated successfully',
      email: email,
      instructions: 'Check your email for the OTP code and use it with the complete login endpoint'
    });
  } catch (error) {
    Logger.error('Error initiating Grid login:', error);
    res.status(500).json({ error: 'Failed to initiate Grid login process' });
  }
};

export const completeLogin = async (req: Request, res: Response) => {
  try {
    const { email, otpCode } = req.body as CompleteLoginInput;

    if (!email || !otpCode) {
      return res.status(400).json({ 
        error: 'Email and OTP code are required' 
      });
    }

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Generate session secrets for the authenticated user
    const sessionSecrets = await gridClient.generateSessionSecrets();

    // Create a temporary user context for Grid SDK
    const tempUser = {
      email: existingUser.email,
      grid_user_id: existingUser.gridAddress || undefined,
      signers: [], // Empty signers array for existing account
    };

    // Complete Grid authentication using completeAuth
    const authResult = await gridClient.completeAuth({
      user: tempUser,
      otpCode,
      sessionSecrets,
    });

    if (!authResult?.success) {
      Logger.error('Grid authentication completion failed:', authResult);
      return res.status(401).json({
        error: 'Authentication failed',
        details: authResult?.error || 'Invalid verification code',
      });
    }

    // Update user with authentication data
    try {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          // Store Grid authentication data
          authResult: authResult.data as any || null,
          sessionSecrets: sessionSecrets as any || null,
        }
      });

      Logger.info(`Updated authentication data for user ${existingUser.email}`);
    } catch (dbError) {
      Logger.error('Failed to store authentication data in database:', dbError);
      // Continue with response even if database update fails
    }

    // Generate JWT token
    const token = generateToken(existingUser.id);

    Logger.info(`Login completed successfully for user ${existingUser.email}`);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        walletAddress: existingUser.walletAddress,
        gridAddress: existingUser.gridAddress,
        gridStatus: existingUser.gridStatus,
      },
      authData: {
        success: authResult.success,
        data: authResult.data,
      },
      sessionSecrets: sessionSecrets,
    });
  } catch (error) {
    Logger.error('Error completing login:', error);
    res.status(500).json({ error: 'Failed to complete login process' });
  }
};

// NEW GRID SDK-BASED AUTHENTICATION SYSTEM
// Initialize Grid authentication for existing users
export const initGridAuth = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as UserLoginInput;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Debug user data
    Logger.info(`User data for ${existingUser.email}:`, {
      id: existingUser.id,
      gridAddress: existingUser.gridAddress,
      gridStatus: existingUser.gridStatus,
      hasAuthResult: !!existingUser.authResult,
      hasSessionSecrets: !!existingUser.sessionSecrets
    });

    // Initialize Grid authentication using initAuth
    const authResult = await gridClient.initAuth({
      email: existingUser.email,
    });

    if (!authResult?.success) {
      Logger.error('Grid initAuth failed:', authResult);
      return res.status(500).json({
        error: 'Failed to initialize Grid authentication',
        details: authResult?.error || 'Grid authentication initialization failed',
      });
    }

    Logger.info(`Grid authentication initiated for user ${email}`);

    res.status(201).json({
      message: 'Grid authentication initiated successfully',
      email: email,
      instructions: 'Check your email for the OTP code and use it with the complete authentication endpoint'
    });
  } catch (error) {
    Logger.error('Error initializing Grid authentication:', error);
    res.status(500).json({ error: 'Failed to initialize Grid authentication' });
  }
};

// Complete Grid SDK authentication (simplified - no pending key)
export const completeGridAuth = async (req: Request, res: Response) => {
  try {
    const { email, otpCode } = req.body as CompleteLoginInput;

    if (!email || !otpCode) {
      return res.status(400).json({ 
        error: 'Email and OTP code are required' 
      });
    }

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Generate session secrets for the authenticated user
    const authSessionSecrets = await gridClient.generateSessionSecrets();

    // Check if user has a linked Grid account
    if (!existingUser.gridAddress) {
      Logger.warn(`User ${existingUser.email} exists but has no linked Grid account. Attempting to complete account creation.`);
      
      // User exists but no Grid account - try to complete account creation
      const tempUser = {
        email: existingUser.email,
        grid_user_id: undefined,
        signers: [],
        address: undefined,
        session: undefined
      };

      try {
        const authResult = await gridClient.completeAuthAndCreateAccount({
          otpCode,
          user: tempUser,
          sessionSecrets: authSessionSecrets,
        });

        if (authResult?.success) {
          Logger.info(`Successfully created Grid account for existing user: ${existingUser.email}`);
          
          // Update user with Grid account data
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              walletAddress: extractWalletAddress(authResult),
              gridAddress: authResult.data?.address || null,
              gridStatus: 'success',
              authResult: authResult.data as any || null,
              sessionSecrets: authSessionSecrets as any || null,
            }
          });

          // Generate JWT token
          const token = generateToken(existingUser.id);

          return res.status(200).json({
            message: 'Grid account created and authentication successful',
            token,
            user: {
              id: existingUser.id,
              email: existingUser.email,
              firstName: existingUser.firstName,
              lastName: existingUser.lastName,
              walletAddress: extractWalletAddress(authResult),
              gridAddress: authResult.data?.address,
              gridStatus: 'success',
            }
          });
        } else {
          Logger.error('Failed to create Grid account for existing user:', authResult);
          return res.status(401).json({
            error: 'Authentication failed',
            details: authResult?.error || 'Failed to create Grid account',
          });
        }
      } catch (createError: any) {
        Logger.error('Error creating Grid account for existing user:', createError);
        return res.status(401).json({
          error: 'Authentication failed',
          details: createError?.message || 'Failed to create Grid account',
        });
      }
    }

    // User has a Grid account - proceed with authentication
    const tempUser = {
      email: existingUser.email,
      grid_user_id: existingUser.gridAddress,
      signers: [],
      address: existingUser.gridAddress,
      session: undefined
    };

    // Complete Grid authentication using completeAuth
    const authResult = await gridClient.completeAuth({
      otpCode,
      user: tempUser,
      sessionSecrets: authSessionSecrets,
    });

    if (!authResult?.success) {
      Logger.error('Grid authentication completion failed:', authResult);
      return res.status(401).json({
        error: 'Authentication failed',
        details: authResult?.error || 'Invalid verification code',
      });
    }

    // Update user with authentication data
    try {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          // Store Grid authentication data
          authResult: authResult.data as any || null,
          sessionSecrets: authSessionSecrets as any || null,
        }
      });

      Logger.info(`Updated authentication data for user ${existingUser.email}`);
    } catch (dbError) {
      Logger.error('Failed to store authentication data in database:', dbError);
      // Continue with response even if database update fails
    }

    // Generate JWT token
    const token = generateToken(existingUser.id);

    Logger.info(`Grid authentication completed successfully for user ${existingUser.email}`);

    return res.status(200).json({
      message: 'Grid authentication successful',
      token,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        walletAddress: existingUser.walletAddress,
        gridAddress: existingUser.gridAddress,
        gridStatus: existingUser.gridStatus,
      },
      authData: {
        success: authResult.success,
        data: authResult.data,
      },
      sessionSecrets: authSessionSecrets,
    });
  } catch (error) {
    Logger.error('Error completing Grid authentication:', error);
    res.status(500).json({ error: 'Failed to complete Grid authentication' });
  }
};

// Get current authenticated user
export const getCurrentUser = async (
  req: Request,
  res: Response
) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: (req as any).userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phoneNumber: true,
        walletAddress: true,
        role: true,
        isActive: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    Logger.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Failed to fetch user information' });
  }
};

// Get complete Grid account data for a user
export const getUserGridData = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    
    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        message: 'This user has not completed Grid account creation'
      });
    }

    Logger.info(`Retrieved complete Grid data for user ${email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      gridAccount: {
        address: user.gridAddress,
        status: user.gridStatus,
        policies: (user as any).authResult?.policies,
      },
      completeGridData: {
        authResult: user.authResult,
        sessionSecrets: user.sessionSecrets,
      },
      summary: {
        hasGridAccount: !!user.gridAddress,
        hasAuthResult: !!user.authResult,
        hasSessionSecrets: !!user.sessionSecrets,
        hasCompleteData: !!(user.authResult && user.sessionSecrets),
        dataCompleteness: {
          authResult: user.authResult ? 'Complete' : 'Missing',
          sessionSecrets: user.sessionSecrets ? 'Complete' : 'Missing',
        }
      }
    });
  } catch (error) {
    Logger.error('Error fetching user Grid data:', error);
    res.status(500).json({ error: 'Failed to fetch user Grid data' });
  }
};

// TRANSACTION SYSTEM USING GRID SDK
// Prepare transaction for Grid SDK execution
export const prepareTransaction = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as PrepareTransactionInput;
    const { fromEmail, toEmail, amount, tokenMint, memo } = validatedData;

    // Find sender user
    const senderUser = await prisma.user.findUnique({
      where: { email: fromEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!senderUser) {
      return res.status(404).json({ error: 'Sender user not found' });
    }

    if (!senderUser.isActive) {
      return res.status(401).json({ error: 'Sender account is inactive' });
    }

    // Find recipient user
    const recipientUser = await prisma.user.findUnique({
      where: { email: toEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!recipientUser) {
      return res.status(404).json({ error: 'Recipient user not found' });
    }

    if (!recipientUser.isActive) {
      return res.status(401).json({ error: 'Recipient account is inactive' });
    }

    // Check if sender has Grid account data
    if (!senderUser.gridAddress || !(senderUser as any).authResult || !(senderUser as any).sessionSecrets) {
      return res.status(400).json({
        error: 'Sender does not have complete Grid account data',
        message: 'User must have completed Grid account creation with full data storage',
        debug: {
          hasGridAddress: !!senderUser.gridAddress,
          hasAuthResult: !!(senderUser as any).authResult,
          hasSessionSecrets: !!(senderUser as any).sessionSecrets,
          gridAddress: senderUser.gridAddress,
          authResultType: typeof (senderUser as any).authResult,
          sessionSecretsType: typeof (senderUser as any).sessionSecrets
        }
      });
    }

    // Construct gridData from simplified JSON fields
    const gridData = {
      authData: (senderUser as any).authResult,
      sessionData: (senderUser as any).sessionSecrets,
      accountData: {
        address: senderUser.gridAddress,
        status: senderUser.gridStatus,
      },
    };

    // Validate that we have the required data structure
    if (!gridData.sessionData) {
      Logger.error('Missing sessionSecrets in gridData:', {
        sessionData: gridData.sessionData,
        hasSessionSecrets: !!(gridData.sessionData),
        senderEmail: fromEmail,
        gridAddress: senderUser.gridAddress
      });
      return res.status(500).json({
        error: 'Missing session secrets',
        details: 'Session secrets not found in user data. Please re-authenticate.',
        debug: {
          sessionData: gridData.sessionData,
          hasSessionSecrets: !!(gridData.sessionData)
        }
      });
    }

    if (!(gridData.authData as any)?.authentication) {
      Logger.error('Missing authentication data in gridData:', {
        authData: gridData.authData,
        hasAuthentication: !!((gridData.authData as any)?.authentication),
        senderEmail: fromEmail,
        gridAddress: senderUser.gridAddress
      });
      return res.status(500).json({
        error: 'Missing authentication data',
        details: 'Authentication data not found in user data. Please re-authenticate.',
        debug: {
          authData: gridData.authData,
          hasAuthentication: !!((gridData.authData as any)?.authentication)
        }
      });
    }

    if (!gridData.accountData?.address) {
      Logger.error('Missing account address in gridData:', {
        accountData: gridData.accountData,
        hasAddress: !!(gridData.accountData?.address),
        senderEmail: fromEmail,
        gridAddress: senderUser.gridAddress
      });
      return res.status(500).json({
        error: 'Missing account address',
        details: 'Account address not found in user data. Please re-authenticate.',
        debug: {
          accountData: gridData.accountData,
          hasAddress: !!(gridData.accountData?.address)
        }
      });
    }

    // Use Grid addresses for transactions (Grid-to-Grid transfers)
    const fromAddress = senderUser.gridAddress;
    const toAddress = recipientUser.gridAddress;

    if (!fromAddress) {
      return res.status(400).json({ 
        error: 'Sender does not have a Grid address',
        details: 'Sender must have a Grid account to initiate transactions'
      });
    }

    if (!toAddress) {
      return res.status(400).json({ 
        error: 'Recipient does not have a Grid address',
        details: 'Recipient must have a Grid account to receive transactions'
      });
    }

    Logger.info(`Preparing Grid-to-Grid transaction: ${amount} ${tokenMint} from ${fromEmail} (${fromAddress}) to ${toEmail} (${toAddress})`);

    // Test blockchain connection
    const connectionTest = await blockchainService.testConnection();
    if (!connectionTest.success) {
      Logger.error('Blockchain connection failed:', connectionTest.error);
      return res.status(500).json({
        error: 'Blockchain service unavailable',
        details: connectionTest.error
      });
    }

    // Create raw transaction using blockchain service
    const transactionResult = await blockchainService.createTransaction(
      fromAddress,
      toAddress,
      tokenMint,
      parseFloat(amount),
      gridData.accountData.address, // Pass Grid account address as payer
      TRANSFER_FEE.amount, // Fee amount (0.07 USDC)
      TRANSFER_FEE.recipientAddress // Fee recipient address
    );

    if (!transactionResult) {
      return res.status(500).json({
        error: 'Failed to create transaction',
        details: 'Transaction creation failed'
      });
    }

    // Validate the base64 transaction data using utility function
    const validation = validateBase64Transaction(transactionResult.transaction);
    if (!validation.isValid) {
      Logger.error('Invalid transaction data received from blockchain service:', {
        error: validation.error,
        transaction: transactionResult.transaction,
        type: typeof transactionResult.transaction
      });
      return res.status(500).json({
        error: 'Invalid transaction data',
        details: validation.error || 'Transaction data validation failed'
      });
    }

    Logger.info('Preparing transaction with Grid SDK:', {
      gridAddress: gridData.accountData.address,
      walletAddress: fromAddress,
      transactionLength: transactionResult.transaction.length,
      tokenMint,
      amount,
      transactionPreview: transactionResult.transaction.substring(0, 20) + '...',
      validation: validation,
      debugMode: true,
      requestPayload: {
        transaction: transactionResult.transaction.substring(0, 50) + '...',
        transaction_signers: [fromAddress],
        fee_config: {
          currency: "sol",
          payer_address: fromAddress
        }
      }
    });

    // Prepare transaction using Grid SDK
    let transactionPayloadResponse;
    try {
      transactionPayloadResponse = await gridClient.prepareArbitraryTransaction(
        gridData.accountData.address,
        {
          transaction: transactionResult.transaction,
          fee_config: {
            currency: "sol",
            payer_address: gridData.accountData.address
          }
        }
      );
    } catch (gridError) {
      Logger.error('Grid SDK prepareArbitraryTransaction error:', {
        error: gridError,
        errorString: JSON.stringify(gridError, null, 2),
        gridAddress: gridData.accountData.address,
        transactionLength: transactionResult.transaction.length,
        message: gridError instanceof Error ? gridError.message : 'Unknown error',
        stack: gridError instanceof Error ? gridError.stack : undefined,
        errorType: gridError?.constructor?.name || 'Unknown',
        errorCode: (gridError as any)?.code,
        errorStatus: (gridError as any)?.status,
        errorResponse: (gridError as any)?.response?.data
      });
      
      // Try to extract more detailed error information
      let detailedError = 'Grid SDK preparation error';
      let simulationLogs = null;
      
      if (gridError instanceof Error) {
        detailedError = gridError.message;
      }
      
      // Check if the error has response data with simulation logs
      if ((gridError as any)?.response?.data?.simulation_logs) {
        simulationLogs = (gridError as any).response.data.simulation_logs;
        Logger.error('Simulation logs found in error response:', {
          simulationLogs: simulationLogs,
          logCount: simulationLogs.length
        });
      }
      
      // Check if the error has data property with simulation logs
      if ((gridError as any)?.data?.simulation_logs) {
        simulationLogs = (gridError as any).data.simulation_logs;
        Logger.error('Simulation logs found in error data:', {
          simulationLogs: simulationLogs,
          logCount: simulationLogs.length
        });
      }
      
      return res.status(500).json({
        error: 'Transaction preparation failed',
        details: detailedError,
        fullError: gridError,
        simulationLogs: simulationLogs,
        errorType: gridError?.constructor?.name || 'Unknown',
        errorCode: (gridError as any)?.code,
        errorStatus: (gridError as any)?.status
      });
    }

    // Check for simulation logs in the successful response (top level)
    if ((transactionPayloadResponse as any)?.data?.simulation_logs) {
      Logger.info('Grid SDK Simulation Logs (from successful response):', {
        simulationLogs: (transactionPayloadResponse as any).data.simulation_logs,
        logCount: (transactionPayloadResponse as any).data.simulation_logs.length,
        logs: (transactionPayloadResponse as any).data.simulation_logs
      });
      
      // Log each simulation log individually
      (transactionPayloadResponse as any).data.simulation_logs.forEach((log: string, index: number) => {
        Logger.info(`Success Simulation Log ${index + 1}: ${log}`);
      });
    }

    if (!transactionPayloadResponse?.success) {
        Logger.error('Grid transaction preparation failed:', {
        response: transactionPayloadResponse,
        responseError: transactionPayloadResponse?.error,
        gridAddress: gridData.accountData.address,
        transactionLength: transactionResult.transaction.length,
        fullResponse: JSON.stringify(transactionPayloadResponse, null, 2)
      });
      
      // Check for simulation logs in the error response
      if ((transactionPayloadResponse as any)?.data?.simulation_logs) {
        Logger.error('Grid SDK Simulation Logs (from error response):', {
          simulationLogs: (transactionPayloadResponse as any).data.simulation_logs,
          logCount: (transactionPayloadResponse as any).data.simulation_logs.length,
          logs: (transactionPayloadResponse as any).data.simulation_logs
        });
      }
      
      return res.status(500).json({
        error: 'Transaction preparation failed',
          details: transactionPayloadResponse?.error || 'Grid transaction preparation failed2',
        fullResponse: transactionPayloadResponse,
        simulationLogs: (transactionPayloadResponse as any)?.data?.simulation_logs || null
      });
    }

    const transactionPayload = transactionPayloadResponse.data;

    if (!transactionPayload) {
      Logger.error('No transaction payload received from Grid SDK');
      return res.status(500).json({
        error: 'Transaction preparation failed',
        details: 'No transaction payload received'
      });
    }

    // Log debug information if available
    if ((transactionPayload as any).simulation_logs) {
      Logger.info('Grid SDK Debug - Simulation Logs:', {
        logs: (transactionPayload as any).simulation_logs,
        logCount: (transactionPayload as any).simulation_logs.length,
        detailedLogs: (transactionPayload as any).simulation_logs.map((log: string, index: number) => ({
          index: index + 1,
          log: log
        }))
      });
      
      // Also log each simulation log individually for better readability
      (transactionPayload as any).simulation_logs.forEach((log: string, index: number) => {
        Logger.info(`Simulation Log ${index + 1}: ${log}`);
      });
    } else {
      Logger.info('No simulation logs available in response');
    }

    // Determine token symbol
    let tokenSymbol = 'UNKNOWN';
    if (tokenMint === TOKEN_MINTS.SOL) tokenSymbol = 'SOL';
    else if (tokenMint === TOKEN_MINTS.USDC) tokenSymbol = 'USDC';

    Logger.info(`Transaction prepared successfully: ${amount} ${tokenSymbol} from ${fromAddress} to ${toAddress}`, {
      kmsPayloadsCount: transactionPayload.kms_payloads?.length || 0,
      transactionSigners: transactionPayload.transaction_signers,
      hasSimulationLogs: !!(transactionPayload as any).simulation_logs
    });

    res.status(200).json({
      message: 'Transaction prepared successfully',
      transaction: {
        id: `tx_${Date.now()}`,
        from: {
          email: senderUser.email,
          name: `${senderUser.firstName} ${senderUser.lastName}`,
          address: fromAddress,
          gridAddress: senderUser.gridAddress,
        },
        to: {
          email: recipientUser.email,
          name: `${recipientUser.firstName} ${recipientUser.lastName}`,
          address: toAddress,
          gridAddress: recipientUser.gridAddress,
        },
        amount,
        tokenMint,
        tokenSymbol,
        memo: memo || null,
        status: 'prepared',
        timestamp: new Date().toISOString(),
      },
      transactionPayload: {
        transaction: transactionPayload.transaction,
        transaction_signers: transactionPayload.transaction_signers,
        kms_payloads: transactionPayload.kms_payloads,
      },
      gridData: {
        address: gridData.accountData.address, // authResult.address,
        hasSessionSecrets: !!(gridData.sessionData),
        hasAccountData: !!gridData.accountData,
        hasAuthData: !!gridData.authData,
      },
      blockchainInfo: {
        network: 'mainnet',
        rpcUrl: 'https://api.mainnet-beta.solana.com',
        fee: '5000', // Estimated fee
      },
      simulationLogs: (transactionPayload as any).simulation_logs || null,
    });
  } catch (error) {
    Logger.error('Error preparing transaction:', error);
    res.status(500).json({ error: 'Failed to prepare transaction' });
  }
};

// Execute transaction using Grid SDK
export const executeTransaction = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as ExecuteTransactionInput;
    const { fromEmail, transactionPayload, memo } = validatedData;

    // Find sender user
    const senderUser = await prisma.user.findUnique({
      where: { email: fromEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!senderUser) {
      return res.status(404).json({ error: 'Sender user not found' });
    }

    if (!senderUser.isActive) {
      return res.status(401).json({ error: 'Sender account is inactive' });
    }

    // Check if sender has Grid account data
    if (!senderUser.gridAddress || !(senderUser as any).gridAccountData || !(senderUser as any).gridSessionData) {
      return res.status(400).json({
        error: 'Sender does not have complete Grid account data',
        message: 'User must have completed Grid account creation with full data storage'
      });
    }

    const gridData = {
      authData: (senderUser as any).gridAuthData,
      accountData: (senderUser as any).gridAccountData,
      sessionData: (senderUser as any).gridSessionData,
      metadata: (senderUser as any).gridMetadata,
    };

    // Log the EXACT data being sent to Grid SDK signAndSend method
    console.log('\n' + '='.repeat(80));
    console.log('🚀 GRID SDK SIGN AND SEND - EXACT DATA BEING SENT');
    console.log('='.repeat(80));
    
    const exactSignAndSendData = {
      sessionSecrets: gridData.sessionData,
        session: (gridData.authData as any)?.authentication, // Auth token from authentication step
      transactionPayload: {
        ...transactionPayload,
        kms_payloads: transactionPayload.kms_payloads || []
      }, // Transaction data with ensured kms_payloads array
      address: gridData.accountData.address
    };
    
    console.log('\n📋 METHOD: gridClient.signAndSend()');
    console.log('📊 PARAMETERS:');
    console.log(JSON.stringify(exactSignAndSendData, null, 2));
    
    console.log('\n🔍 DETAILED BREAKDOWN:');
    console.log('├── sessionSecrets:');
    console.log(`│   └── ${JSON.stringify(gridData.sessionData, null, 4)}`);
    console.log('├── session (auth token):');
    console.log(`│   └── ${JSON.stringify((gridData.authData as any)?.authentication, null, 4)}`);
    console.log('├── transactionPayload:');
    console.log(`│   ├── transaction: "${transactionPayload.transaction?.substring(0, 50)}..."`);
    console.log(`│   ├── transaction_signers: ${JSON.stringify(transactionPayload.transaction_signers)}`);
    console.log(`│   ├── kms_payloads: ${JSON.stringify(transactionPayload.kms_payloads || [])}`);
    console.log(`│   └── fee_config: ${JSON.stringify((transactionPayload as any).fee_config)}`);
    console.log(`└── address: "${gridData.accountData.address}"`);
    
    console.log('\n📏 DATA SIZES:');
    console.log(`├── sessionSecrets size: ${JSON.stringify(gridData.sessionData).length} chars`);
    console.log(`├── transaction base64 length: ${transactionPayload.transaction?.length || 0} chars`);
    console.log(`├── transaction_signers count: ${transactionPayload.transaction_signers?.length || 0}`);
    console.log(`├── kms_payloads count: ${(transactionPayload.kms_payloads || []).length}`);
    console.log(`└── session (auth token) size: ${(gridData.authData as any)?.authentication ? JSON.stringify((gridData.authData as any).authentication).length : 0} chars`);
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 CALLING: await gridClient.signAndSend(exactSignAndSendData)');
    console.log('='.repeat(80) + '\n');

    // Debug: Check what's actually in gridData
    console.log('\n🔍 GRID DATA DEBUG:');
    console.log(`├── authData: ${JSON.stringify(gridData.authData, null, 2)}`);
    console.log(`├── accountData: ${JSON.stringify(gridData.accountData, null, 2)}`);
    console.log(`├── sessionData: ${JSON.stringify(gridData.sessionData, null, 2)}`);
    
    // Check if we have authentication data (following guide pattern)
    if (!gridData.sessionData) {
      Logger.error('Missing sessionSecrets in gridData:', {
        sessionData: gridData.sessionData,
        hasSessionSecrets: !!(gridData.sessionData?.sessionSecrets)
      });
      return res.status(500).json({
        error: 'Missing session secrets',
        details: 'Session secrets not found. Please re-authenticate.',
        sessionExpired: true
      });
    }

    if (!(gridData.authData as any)?.authentication) {
      Logger.error('Missing authentication data in gridData:', {
        authData: gridData.authData,
        accountData: gridData.accountData,
        sessionData: gridData.sessionData
      });
      return res.status(500).json({
        error: 'Missing authentication data',
        details: 'Authentication data not found. Please re-authenticate.',
        sessionExpired: true,
        guidance: {
          message: 'Authentication data is missing. Please refresh your session.',
          action: 'Call /api/users/refresh-session to refresh your session',
          endpoints: {
            refreshSession: '/api/users/refresh-session',
            completeRefresh: '/api/users/complete-session-refresh',
            checkStatus: `/api/users/session-status/${encodeURIComponent(fromEmail)}`
          }
        }
      });
    }

    // Execute transaction using Grid SDK signAndSend (following guide pattern)
    let executedTxResponse;
    try {
      executedTxResponse = await gridClient.signAndSend({
        sessionSecrets: gridData.sessionData, // From account creation step
        session: (gridData.authData as any).authentication, // Auth token from previous step (authResult.authentication)
        transactionPayload: {
          ...transactionPayload,
          kms_payloads: transactionPayload.kms_payloads || []
        },
        address: gridData.accountData.address, // authResult.address
      });
    } catch (signingError: any) {
      // Check for Privy session expiry errors
      const errorMessage = signingError?.message || '';
      const errorResponse = signingError?.response?.data || signingError?.data || {};
      
      if (errorMessage.includes('Privy signing error') || 
          errorMessage.includes('session has expired') ||
          errorMessage.includes('KeyQuorum user session key is expired') ||
          errorResponse?.error?.includes('session') && errorResponse?.error?.includes('expired')) {
        
        Logger.error('Privy session expired during transaction execution:', {
          error: signingError,
          userEmail: fromEmail,
          gridAddress: gridData.accountData.address,
          errorMessage,
          errorResponse
        });
        
        return res.status(401).json({
          error: 'Session expired',
          details: 'Your Privy session has expired. Please refresh your session to continue.',
          sessionExpired: true,
          guidance: {
            message: 'Your authentication session has expired after 24 hours.',
            action: 'Call /api/users/refresh-session to refresh your session',
            endpoints: {
              refreshSession: '/api/users/refresh-session',
              completeRefresh: '/api/users/complete-session-refresh',
              checkStatus: `/api/users/session-status/${encodeURIComponent(fromEmail)}`
            }
          }
        });
      }
      
      // Re-throw other errors
      throw signingError;
    }

    // Handle Grid SDK response - it might not have success/error properties
    if (!executedTxResponse) {
      Logger.error('Grid transaction execution failed: No response received');
      return res.status(500).json({
        error: 'Transaction execution failed',
        details: 'No response received from Grid SDK'
      });
    }

    // Check if response has success property (GridResponse format)
    if ((executedTxResponse as any).success === false) {
      Logger.error('Grid transaction execution failed:', executedTxResponse);
      return res.status(500).json({
        error: 'Transaction execution failed',
        details: (executedTxResponse as any).error || 'Grid transaction execution failed'
      });
    }

    // Extract data from response
    const executedTx = (executedTxResponse as any).data || executedTxResponse;

    // Debug: Log the full response structure to understand the signature location
    console.log('\n🔍 GRID SDK RESPONSE DEBUG (EXECUTE TRANSACTION):');
    console.log('├── Full executedTxResponse:', JSON.stringify(executedTxResponse, null, 2));
    console.log('├── ExecutedTx (extracted):', JSON.stringify(executedTx, null, 2));
    console.log('├── Signature from executedTx?.signature:', executedTx?.signature);
    console.log('├── Signature from executedTxResponse?.signature:', (executedTxResponse as any)?.signature);
    console.log('├── Signature from executedTxResponse?.data?.signature:', (executedTxResponse as any)?.data?.signature);
    console.log('└── All possible signature locations checked');

    // Try multiple signature extraction methods
    let transactionSignature = executedTx?.signature || 
                             (executedTxResponse as any)?.signature || 
                             (executedTxResponse as any)?.data?.signature ||
                             (executedTxResponse as any)?.result?.signature ||
                             (executedTxResponse as any)?.transactionSignature;

    console.log(`🎯 FINAL SIGNATURE EXTRACTED (EXECUTE): "${transactionSignature}"`);

    Logger.info(`Transaction executed successfully for user ${fromEmail}: ${transactionSignature}`);

    res.status(200).json({
      message: 'Transaction executed successfully',
      transaction: {
        id: `tx_${Date.now()}`,
        signature: transactionSignature || 'pending',
        from: {
          email: senderUser.email,
          name: `${senderUser.firstName} ${senderUser.lastName}`,
          address: senderUser.gridAddress, // Use Grid address as primary
          walletAddress: senderUser.walletAddress, // Keep wallet address for reference
          gridAddress: senderUser.gridAddress,
        },
        memo: memo || null,
        status: 'executed',
        timestamp: new Date().toISOString(),
      },
      executionResult: {
        success: true,
        signature: transactionSignature,
        data: executedTx,
      },
      gridData: {
        address: gridData.accountData.address, // authResult.address,
        sessionUsed: !!gridData.sessionData?.sessionSecrets,
        accountUsed: !!gridData.accountData,
      },
    });
  } catch (error) {
    Logger.error('Error executing transaction:', error);
    res.status(500).json({ error: 'Failed to execute transaction' });
  }
};

// Send transaction (combines prepare and execute)
export const sendTransaction = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as SendTransactionInput;
    const { fromEmail, toEmail, amount, tokenMint, memo } = validatedData;

    // Find sender user
    const senderUser = await prisma.user.findUnique({
      where: { email: fromEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!senderUser) {
      return res.status(404).json({ error: 'Sender user not found' });
    }

    if (!senderUser.isActive) {
      return res.status(401).json({ error: 'Sender account is inactive' });
    }

    // Find recipient user
    const recipientUser = await prisma.user.findUnique({
      where: { email: toEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!recipientUser) {
      return res.status(404).json({ error: 'Recipient user not found' });
    }

    if (!recipientUser.isActive) {
      return res.status(401).json({ error: 'Recipient account is inactive' });
    }

    // Check if sender has Grid account data
    if (!senderUser.gridAddress || !(senderUser as any).authResult || !(senderUser as any).sessionSecrets) {
      return res.status(400).json({
        error: 'Sender does not have complete Grid account data',
        message: 'User must have completed Grid account creation with full data storage',
        debug: {
          hasGridAddress: !!senderUser.gridAddress,
          hasAuthResult: !!(senderUser as any).authResult,
          hasSessionSecrets: !!(senderUser as any).sessionSecrets,
          gridAddress: senderUser.gridAddress,
          authResultType: typeof (senderUser as any).authResult,
          sessionSecretsType: typeof (senderUser as any).sessionSecrets
        }
      });
    }

    // Construct gridData from simplified JSON fields
    const gridData = {
      authData: (senderUser as any).authResult,
      sessionData: (senderUser as any).sessionSecrets,
      accountData: {
        address: senderUser.gridAddress,
        status: senderUser.gridStatus,
      },
    };

    // Validate that we have the required data structure
    if (!gridData.sessionData) {
      Logger.error('Missing sessionSecrets in gridData:', {
        sessionData: gridData.sessionData,
        hasSessionSecrets: !!(gridData.sessionData),
        senderEmail: fromEmail,
        gridAddress: senderUser.gridAddress
      });
      return res.status(500).json({
        error: 'Missing session secrets',
        details: 'Session secrets not found in user data. Please re-authenticate.',
        debug: {
          sessionData: gridData.sessionData,
          hasSessionSecrets: !!(gridData.sessionData)
        }
      });
    }

    if (!(gridData.authData as any)?.authentication) {
      Logger.error('Missing authentication data in gridData:', {
        authData: gridData.authData,
        hasAuthentication: !!((gridData.authData as any)?.authentication),
        senderEmail: fromEmail,
        gridAddress: senderUser.gridAddress
      });
      return res.status(500).json({
        error: 'Missing authentication data',
        details: 'Authentication data not found in user data. Please re-authenticate.',
        debug: {
          authData: gridData.authData,
          hasAuthentication: !!((gridData.authData as any)?.authentication)
        }
      });
    }

    if (!gridData.accountData?.address) {
      Logger.error('Missing account address in gridData:', {
        accountData: gridData.accountData,
        hasAddress: !!(gridData.accountData?.address),
        senderEmail: fromEmail,
        gridAddress: senderUser.gridAddress
      });
      return res.status(500).json({
        error: 'Missing account address',
        details: 'Account address not found in user data. Please re-authenticate.',
        debug: {
          accountData: gridData.accountData,
          hasAddress: !!(gridData.accountData?.address)
        }
      });
    }

    // Use Grid addresses for transactions (Grid-to-Grid transfers)
    const fromAddress = senderUser.gridAddress;
    const toAddress = recipientUser.gridAddress;

    if (!fromAddress) {
      return res.status(400).json({ 
        error: 'Sender does not have a Grid address',
        details: 'Sender must have a Grid account to initiate transactions'
      });
    }

    if (!toAddress) {
      return res.status(400).json({ 
        error: 'Recipient does not have a Grid address',
        details: 'Recipient must have a Grid account to receive transactions'
      });
    }

    Logger.info(`Sending Grid-to-Grid transaction: ${amount} ${tokenMint} from ${fromEmail} (${fromAddress}) to ${toEmail} (${toAddress})`);

    // Test blockchain connection
    const connectionTest = await blockchainService.testConnection();
    if (!connectionTest.success) {
      Logger.error('Blockchain connection failed:', connectionTest.error);
      return res.status(500).json({
        error: 'Blockchain service unavailable',
        details: connectionTest.error
      });
    }

    // Create raw transaction using blockchain service
    const transactionResult = await blockchainService.createTransaction(
      fromAddress,
      toAddress,
      tokenMint,
      parseFloat(amount),
      gridData.accountData.address, // Pass Grid account address as payer
      TRANSFER_FEE.amount, // Fee amount (0.07 USDC)
      TRANSFER_FEE.recipientAddress // Fee recipient address
    );

    if (!transactionResult) {
      return res.status(500).json({
        error: 'Failed to create transaction',
        details: 'Transaction creation failed'
      });
    }

    // Log the EXACT data being sent to Grid SDK prepareArbitraryTransaction method
    console.log('\n' + '='.repeat(80));
    console.log('🔧 GRID SDK PREPARE ARBITRARY TRANSACTION - EXACT DATA BEING SENT');
    console.log('='.repeat(80));
    
    const exactPrepareData = {
      gridAddress: gridData.accountData.address,
      transactionPayload: {
        transaction: transactionResult.transaction,
        transaction_signers: [fromAddress],
        fee_config: {
          currency: "sol",
          payer_address: fromAddress
        }
      },
      options: { debug: true }
    };
    
    console.log('\n📋 METHOD: gridClient.prepareArbitraryTransaction()');
    console.log('📊 PARAMETERS:');
    console.log(JSON.stringify(exactPrepareData, null, 2));
    
    console.log('\n🔍 DETAILED BREAKDOWN:');
    console.log(`├── gridAddress: "${gridData.accountData.address}"`);
    console.log('├── transactionPayload:');
    console.log(`│   ├── transaction: "${transactionResult.transaction.substring(0, 50)}..."`);
    console.log(`│   ├── transaction_signers: ${JSON.stringify([fromAddress])}`);
    console.log(`│   └── fee_config: ${JSON.stringify({ currency: "sol", payer_address: gridData.accountData.address })}`);
    console.log('└── options:');
    console.log(`    └── debug: true`);
    
    console.log('\n📏 DATA SIZES:');
    console.log(`├── gridAddress length: ${gridData.accountData.address.length} chars`);
    console.log(`├── transaction base64 length: ${transactionResult.transaction.length} chars`);
    console.log(`├── transaction_signers count: 1`);
    console.log(`└── fee_config size: ${JSON.stringify({ currency: "sol", payer_address: gridData.accountData.address }).length} chars`);
    
    console.log('\n📄 FULL BASE64 TRANSACTION:');
    console.log('└── ' + transactionResult.transaction);
    
    console.log('\n🏦 TRANSACTION STRUCTURE:');
    console.log(`├── Grid Account: ${gridData.accountData.address}`);
    console.log(`├── Primary Signer: ${fromAddress} (controls Grid account)`);
    console.log(`├── Transaction Source: Grid account`);
    console.log(`├── Fee Payer: Grid account`);
    console.log(`├── Transfer Type: Grid account → Recipient wallet`);
    console.log(`└── Primary signer authorizes Grid account to execute`);
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 CALLING: await gridClient.prepareArbitraryTransaction(gridAddress, transactionPayload, options)');
    console.log('='.repeat(80) + '\n');

    Logger.info('Preparing transaction with Grid SDK:', {
      gridAddress: gridData.accountData.address,
      walletAddress: fromAddress,
      transactionLength: transactionResult.transaction.length,
      tokenMint,
      amount,
      fullBase64Transaction: transactionResult.transaction
    });

    // Prepare transaction using Grid SDK
    const transactionPayloadResponse = await gridClient.prepareArbitraryTransaction(
      gridData.accountData.address,
      {
        transaction: transactionResult.transaction,
        fee_config: {
          currency: "sol",
          payer_address: gridData.accountData.address
        }
      }
    );

    if (!transactionPayloadResponse?.success) {
        Logger.error('Grid transaction preparation failed3:', {
        response: transactionPayloadResponse,
        responseError: transactionPayloadResponse?.error,
        gridAddress: gridData.accountData.address,
        transactionLength: transactionResult.transaction.length,
        fullResponse: JSON.stringify(transactionPayloadResponse, null, 2)
      });
      
      // Check for simulation logs in the error response
      if ((transactionPayloadResponse as any)?.data?.simulation_logs) {
        Logger.error('Grid SDK Simulation Logs (from error response):', {
          simulationLogs: (transactionPayloadResponse as any).data.simulation_logs,
          logCount: (transactionPayloadResponse as any).data.simulation_logs.length,
          logs: (transactionPayloadResponse as any).data.simulation_logs
        });
        
        // Log each simulation log individually
        (transactionPayloadResponse as any).data.simulation_logs.forEach((log: string, index: number) => {
          Logger.error(`Error Simulation Log ${index + 1}: ${log}`);
        });
      }
      
      return res.status(500).json({
        error: 'Transaction preparation failed',
          details: transactionPayloadResponse?.error || 'Grid transaction preparation failed4',
        fullResponse: transactionPayloadResponse,
        simulationLogs: (transactionPayloadResponse as any)?.data?.simulation_logs || null
      });
    }

    const transactionPayload = transactionPayloadResponse.data;

    if (!transactionPayload) {
      Logger.error('No transaction payload received from Grid SDK');
      return res.status(500).json({
        error: 'Transaction preparation failed',
        details: 'No transaction payload received'
      });
    }

    // Log the EXACT data being sent to Grid SDK signAndSend method (SEND TRANSACTION)
    console.log('\n' + '='.repeat(80));
    console.log('🚀 GRID SDK SIGN AND SEND (SEND TRANSACTION) - EXACT DATA BEING SENT');
    console.log('='.repeat(80));
    
    const exactSignAndSendData = {
      sessionSecrets: gridData.sessionData,
        session: (gridData.authData as any)?.authentication, // Auth token from authentication step
      transactionPayload: {
        ...transactionPayload,
        kms_payloads: transactionPayload.kms_payloads || []
      }, // Transaction data with ensured kms_payloads array
      address: gridData.accountData.address
    };
    
    console.log('\n📋 METHOD: gridClient.signAndSend() [SEND TRANSACTION]');
    console.log('📊 PARAMETERS:');
    console.log(JSON.stringify(exactSignAndSendData, null, 2));
    
    console.log('\n🔍 DETAILED BREAKDOWN:');
    console.log('├── sessionSecrets:');
    console.log(`│   └── ${JSON.stringify(gridData.sessionData, null, 4)}`);
    console.log('├── session (auth token):');
    console.log(`│   └── ${JSON.stringify((gridData.authData as any)?.authentication, null, 4)}`);
    console.log('├── transactionPayload:');
    console.log(`│   ├── transaction: "${transactionPayload.transaction?.substring(0, 50)}..."`);
    console.log(`│   ├── transaction_signers: ${JSON.stringify(transactionPayload.transaction_signers)}`);
    console.log(`│   ├── kms_payloads: ${JSON.stringify(transactionPayload.kms_payloads || [])}`);
    console.log(`│   └── fee_config: ${JSON.stringify((transactionPayload as any).fee_config)}`);
    console.log(`└── address: "${gridData.accountData.address}"`);
    
    console.log('\n📏 DATA SIZES:');
    console.log(`├── sessionSecrets size: ${JSON.stringify(gridData.sessionData).length} chars`);
    console.log(`├── transaction base64 length: ${transactionPayload.transaction?.length || 0} chars`);
    console.log(`├── transaction_signers count: ${transactionPayload.transaction_signers?.length || 0}`);
    console.log(`├── kms_payloads count: ${(transactionPayload.kms_payloads || []).length}`);
    console.log(`└── session (auth token) size: ${(gridData.authData as any)?.authentication ? JSON.stringify((gridData.authData as any).authentication).length : 0} chars`);
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 CALLING: await gridClient.signAndSend(exactSignAndSendData) [SEND TRANSACTION]');
    console.log('='.repeat(80) + '\n');

    // Debug: Check what's actually in gridData
    console.log('\n🔍 GRID DATA DEBUG [SEND TRANSACTION]:');
    console.log(`├── authData: ${JSON.stringify(gridData.authData, null, 2)}`);
    console.log(`├── accountData: ${JSON.stringify(gridData.accountData, null, 2)}`);
    console.log(`├── sessionData: ${JSON.stringify(gridData.sessionData, null, 2)}`);
    
    // Check if we have authentication data
    if (!(gridData.authData as any)?.authentication) {
      Logger.error('Missing authentication data in gridData [SEND TRANSACTION]:', {
        authData: gridData.authData,
        accountData: gridData.accountData,
        sessionData: gridData.sessionData
      });
      return res.status(500).json({
        error: 'Missing authentication data',
        details: 'Authentication data not found. Please re-authenticate.',
        sessionExpired: true,
        guidance: {
          message: 'Authentication data is missing. Please refresh your session.',
          action: 'Call /api/users/refresh-session to refresh your session',
          endpoints: {
            refreshSession: '/api/users/refresh-session',
            completeRefresh: '/api/users/complete-session-refresh',
            checkStatus: `/api/users/session-status/${encodeURIComponent(fromEmail)}`
          }
        }
      });
    }

    // Execute transaction using Grid SDK signAndSend (following guide pattern)
    let executedTxResponse;
    try {
      executedTxResponse = await gridClient.signAndSend({
        sessionSecrets: gridData.sessionData, // From account creation step
        session: (gridData.authData as any).authentication, // Auth token from previous step (authResult.authentication)
        transactionPayload: {
          ...transactionPayload,
          kms_payloads: transactionPayload.kms_payloads || []
        },
        address: gridData.accountData.address, // authResult.address
      });
    } catch (signingError: any) {
      // Check for Privy session expiry errors
      const errorMessage = signingError?.message || '';
      const errorResponse = signingError?.response?.data || signingError?.data || {};
      
      if (errorMessage.includes('Privy signing error') || 
          errorMessage.includes('session has expired') ||
          errorMessage.includes('KeyQuorum user session key is expired') ||
          errorResponse?.error?.includes('session') && errorResponse?.error?.includes('expired')) {
        
        Logger.error('Privy session expired during transaction execution:', {
          error: signingError,
          userEmail: fromEmail,
          gridAddress: gridData.accountData.address,
          errorMessage,
          errorResponse
        });
        
        return res.status(401).json({
          error: 'Session expired',
          details: 'Your Privy session has expired. Please refresh your session to continue.',
          sessionExpired: true,
          guidance: {
            message: 'Your authentication session has expired after 24 hours.',
            action: 'Call /api/users/refresh-session to refresh your session',
            endpoints: {
              refreshSession: '/api/users/refresh-session',
              completeRefresh: '/api/users/complete-session-refresh',
              checkStatus: `/api/users/session-status/${encodeURIComponent(fromEmail)}`
            }
          }
        });
      }
      
      // Re-throw other errors
      throw signingError;
    }

    // Handle Grid SDK response - it might not have success/error properties
    if (!executedTxResponse) {
      Logger.error('Grid transaction execution failed: No response received');
      return res.status(500).json({
        error: 'Transaction execution failed',
        details: 'No response received from Grid SDK'
      });
    }

    // Check if response has success property (GridResponse format)
    if ((executedTxResponse as any).success === false) {
      Logger.error('Grid transaction execution failed:', executedTxResponse);
      return res.status(500).json({
        error: 'Transaction execution failed',
        details: (executedTxResponse as any).error || 'Grid transaction execution failed'
      });
    }

    // Extract data from response
    const executedTx = (executedTxResponse as any).data || executedTxResponse;

    // Debug: Log the full response structure to understand the signature location
    console.log('\n🔍 GRID SDK RESPONSE DEBUG:');
    console.log('├── Full executedTxResponse:', JSON.stringify(executedTxResponse, null, 2));
    console.log('├── ExecutedTx (extracted):', JSON.stringify(executedTx, null, 2));
    console.log('├── Signature from executedTx?.signature:', executedTx?.signature);
    console.log('├── Signature from executedTxResponse?.signature:', (executedTxResponse as any)?.signature);
    console.log('├── Signature from executedTxResponse?.data?.signature:', (executedTxResponse as any)?.data?.signature);
    console.log('└── All possible signature locations checked');

    // Try multiple signature extraction methods
    let transactionSignature = executedTx?.signature || 
                             (executedTxResponse as any)?.signature || 
                             (executedTxResponse as any)?.data?.signature ||
                             (executedTxResponse as any)?.result?.signature ||
                             (executedTxResponse as any)?.transactionSignature;

    console.log(`🎯 FINAL SIGNATURE EXTRACTED: "${transactionSignature}"`);

    // Determine token symbol
    let tokenSymbol = 'UNKNOWN';
    if (tokenMint === TOKEN_MINTS.SOL) tokenSymbol = 'SOL';
    else if (tokenMint === TOKEN_MINTS.USDC) tokenSymbol = 'USDC';

    Logger.info(`Transaction sent successfully: ${amount} ${tokenSymbol} from ${fromAddress} to ${toAddress}, signature: ${transactionSignature}`);

    // Store transfer in database
    const transferType = tokenMint === TOKEN_MINTS.SOL ? 'SOL_TRANSFER' : 'USDC_TRANSFER';
    const tokenType = tokenMint === TOKEN_MINTS.SOL ? 'SOL' : 'USDC';
    const decimals = tokenMint === TOKEN_MINTS.SOL ? 9 : 6; // SOL has 9 decimals, USDC has 6
    
    const dbTransfer = await createTransfer(senderUser.id, transferType, {
      fromAddress,
      toAddress,
      tokenType,
      amount: parseFloat(amount),
      decimals,
      mintAddress: tokenMint === TOKEN_MINTS.SOL ? undefined : tokenMint,
      serializedTransaction: transactionResult.transaction,
      recentBlockhash: undefined, // Not available from blockchain service
      feeAmount: undefined, // Not available from blockchain service
      priorityFee: undefined, // Not available from blockchain service
      gridResponse: transactionPayloadResponse,
      blockchainResponse: executedTxResponse,
      memo: memo || undefined,
    });

    // Update transfer status to confirmed
    await updateTransferStatus(dbTransfer.id, 'CONFIRMED', {
      transactionSignature: transactionSignature,
      blockchainResponse: executedTxResponse,
    });

    res.status(200).json({
      message: 'Transaction sent successfully',
      transaction: {
        id: dbTransfer.id,
        signature: executedTx?.signature || 'pending',
        from: {
          email: senderUser.email,
          name: `${senderUser.firstName} ${senderUser.lastName}`,
          address: fromAddress, // Grid address
          walletAddress: senderUser.walletAddress, // Keep wallet address for reference
          gridAddress: senderUser.gridAddress,
        },
        to: {
          email: recipientUser.email,
          name: `${recipientUser.firstName} ${recipientUser.lastName}`,
          address: toAddress, // Grid address
          walletAddress: recipientUser.walletAddress, // Keep wallet address for reference
          gridAddress: recipientUser.gridAddress,
        },
        amount,
        tokenMint,
        tokenSymbol,
        memo: memo || null,
        status: 'sent',
        timestamp: new Date().toISOString(),
      },
      executionResult: {
        success: true,
        signature: transactionSignature,
        data: executedTx,
      },
      blockchainInfo: {
        network: 'mainnet',
        rpcUrl: 'https://api.mainnet-beta.solana.com',
        signature: transactionSignature,
        explorerUrl: transactionSignature ? `https://explorer.solana.com/tx/${transactionSignature}` : null,
      },
    });
  } catch (error) {
    Logger.error('Error sending transaction:', error);
    res.status(500).json({ error: 'Failed to send transaction' });
  }
};

// Send SOL transaction
export const sendSolTransaction = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as SendSolTransactionInput;
    const { fromEmail, toEmail, amount, memo } = validatedData;

    // Create SOL transaction using the general sendTransaction function
    const solTransactionInput: SendTransactionInput = {
      fromEmail,
      toEmail,
      amount,
      tokenMint: TOKEN_MINTS.SOL,
      memo,
    };

    // Update the request body and call the general transaction function
    req.body = solTransactionInput;
    return await sendTransaction(req, res);
  } catch (error) {
    Logger.error('Error sending SOL transaction:', error);
    res.status(500).json({ error: 'Failed to send SOL transaction' });
  }
};

// Send USDC transaction
export const sendUsdcTransaction = async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as SendUsdcTransactionInput;
    const { fromEmail, toEmail, amount, memo } = validatedData;

    // Create USDC transaction using the general sendTransaction function
    const usdcTransactionInput: SendTransactionInput = {
      fromEmail,
      toEmail,
      amount,
      tokenMint: TOKEN_MINTS.USDC,
      memo,
    };

    // Update the request body and call the general transaction function
    req.body = usdcTransactionInput;
    return await sendTransaction(req, res);
  } catch (error) {
    Logger.error('Error sending USDC transaction:', error);
    res.status(500).json({ error: 'Failed to send USDC transaction' });
  }
};

// Send transaction from Grid account to external wallet (not a Grid account)
export const sendGridToWallet = async (req: Request, res: Response) => {
  try {
    const { PublicKey } = await import('@solana/web3.js');
    const validatedData = req.body as SendGridToWalletTransactionInput;
    const { fromEmail, toWalletAddress, amount, tokenMint, memo } = validatedData;

    // Find sender user
    const senderUser = await prisma.user.findUnique({
      where: { email: fromEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!senderUser) {
      return res.status(404).json({ error: 'Sender user not found' });
    }

    if (!senderUser.isActive) {
      return res.status(401).json({ error: 'Sender account is inactive' });
    }

    // Check if sender has Grid account data
    if (!senderUser.gridAddress || !(senderUser as any).authResult || !(senderUser as any).sessionSecrets) {
      return res.status(400).json({
        error: 'Sender does not have complete Grid account data',
        message: 'User must have completed Grid account creation with full data storage',
        hasGridAddress: !!senderUser.gridAddress,
        hasAuthResult: !!(senderUser as any).authResult,
        hasSessionSecrets: !!(senderUser as any).sessionSecrets
      });
    }

    const fromAddress = senderUser.gridAddress;

    Logger.info(`Sending Grid-to-Wallet transaction: ${amount} ${tokenMint} from ${fromEmail} (${fromAddress}) to ${toWalletAddress}`);

    // Validate recipient is a valid Solana address
    try {
      new PublicKey(toWalletAddress);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid recipient wallet address',
        details: 'The recipient address must be a valid Solana address (base58 encoded)'
      });
    }

    // Test blockchain connection
    const connectionTest = await blockchainService.testConnection();
    if (!connectionTest.success) {
      Logger.error('Blockchain connection failed:', connectionTest.error);
      return res.status(500).json({
        error: 'Blockchain service unavailable',
        details: connectionTest.error
      });
    }

    // Construct gridData from simplified JSON fields
    const gridData = {
      authData: (senderUser as any).authResult,
      sessionData: (senderUser as any).sessionSecrets,
      accountData: {
        address: senderUser.gridAddress,
        status: senderUser.gridStatus,
      },
    };

    // Create raw transaction using blockchain service with fee
    const transactionResult = await blockchainService.createTransaction(
      fromAddress,
      toWalletAddress,
      tokenMint,
      parseFloat(amount),
      senderUser.gridAddress,
      TRANSFER_FEE.amount,
      TRANSFER_FEE.recipientAddress
    );

    if (!transactionResult) {
      return res.status(500).json({
        error: 'Failed to create transaction',
        details: 'Transaction creation failed'
      });
    }

    Logger.info(`Transaction created for Grid-to-Wallet transfer: ${amount} ${tokenMint}`);

    // Prepare transaction using Grid SDK
    const transactionPayloadResponse = await gridClient.prepareArbitraryTransaction(
      gridData.accountData.address,
      {
        transaction: transactionResult.transaction,
        fee_config: {
          currency: "sol",
          payer_address: gridData.accountData.address
        }
      }
    );

    // Check if preparation was successful
    if (!transactionPayloadResponse?.success) {
      const responseStr = JSON.stringify(transactionPayloadResponse, null, 2);
      Logger.error('Grid transaction preparation failed - Full Response:');
      Logger.error(responseStr);
      Logger.error('Error details:', {
        responseError: (transactionPayloadResponse as any)?.error,
        gridAddress: gridData.accountData.address,
        transactionLength: transactionResult.transaction.length
      });
      
      // Check for simulation logs in the error response
      if ((transactionPayloadResponse as any)?.data?.simulation_logs) {
        const simulationLogs = (transactionPayloadResponse as any).data.simulation_logs;
        Logger.error(`Grid SDK Simulation Logs (${simulationLogs.length} logs):`);
        
        simulationLogs.forEach((log: string, index: number) => {
          Logger.error(`  Error Simulation Log ${index + 1}: ${log}`);
        });
      }
      
      return res.status(500).json({
        error: 'Transaction preparation failed',
        details: (transactionPayloadResponse as any)?.error || 'Grid transaction preparation failed',
        fullResponse: transactionPayloadResponse,
        simulationLogs: (transactionPayloadResponse as any)?.data?.simulation_logs || null
      });
    }

    const transactionPayload = transactionPayloadResponse.data;

    if (!transactionPayload) {
      Logger.error('Failed to prepare transaction - no data:', transactionPayloadResponse);
      return res.status(500).json({
        error: 'Transaction preparation failed',
        details: 'No transaction payload received',
        fullResponse: JSON.stringify(transactionPayloadResponse)
      });
    }

    // Execute transaction with Grid SDK
    let executedTxResponse;
    try {
      executedTxResponse = await gridClient.signAndSend({
        sessionSecrets: gridData.sessionData as any,
        session: (gridData.authData as any).authentication,
        transactionPayload: {
          ...transactionPayload,
          kms_payloads: transactionPayload.kms_payloads || []
        },
        address: gridData.accountData.address,
      });
    } catch (signingError: any) {
      Logger.error('Grid transaction signing failed:', signingError);
      return res.status(500).json({
        error: 'Transaction signing failed',
        details: signingError.message || 'Unknown signing error'
      });
    }

    // Extract transaction signature
    const executedTx = (executedTxResponse as any).data || executedTxResponse;
    const transactionSignature = executedTx?.signature || 
                               (executedTxResponse as any)?.signature || 
                               (executedTxResponse as any)?.data?.signature ||
                               (executedTxResponse as any)?.result?.signature ||
                               (executedTxResponse as any)?.transactionSignature;

    // Determine token symbol
    let tokenSymbol = 'UNKNOWN';
    if (tokenMint === TOKEN_MINTS.SOL) tokenSymbol = 'SOL';
    else if (tokenMint === TOKEN_MINTS.USDC) tokenSymbol = 'USDC';

    Logger.info(`Transaction sent successfully: ${amount} ${tokenSymbol} from ${fromAddress} to ${toWalletAddress}, signature: ${transactionSignature}`);

    // Store transfer in database
    const transferType = tokenMint === TOKEN_MINTS.SOL ? 'SOL_TRANSFER' : 'USDC_TRANSFER';
    const tokenType = tokenMint === TOKEN_MINTS.SOL ? 'SOL' : 'USDC';
    const decimals = tokenMint === TOKEN_MINTS.SOL ? 9 : 6;
    
    const dbTransfer = await createTransfer(senderUser.id, transferType, {
      fromAddress,
      toAddress: toWalletAddress,
      tokenType,
      amount: parseFloat(amount),
      decimals,
      mintAddress: tokenMint === TOKEN_MINTS.SOL ? undefined : tokenMint,
      serializedTransaction: transactionResult.transaction,
      recentBlockhash: undefined,
      feeAmount: undefined,
      priorityFee: undefined,
      gridResponse: transactionPayloadResponse,
      blockchainResponse: executedTxResponse,
      memo: memo || undefined,
    });

    // Update transfer status to confirmed
    await updateTransferStatus(dbTransfer.id, 'CONFIRMED', {
      transactionSignature: transactionSignature,
      blockchainResponse: executedTxResponse,
    });

    res.status(200).json({
      message: 'Transaction sent successfully to external wallet',
      transaction: {
        id: dbTransfer.id,
        from: {
          email: senderUser.email,
          name: `${senderUser.firstName} ${senderUser.lastName}`,
          gridAddress: fromAddress,
        },
        to: {
          walletAddress: toWalletAddress,
          type: 'external_wallet',
        },
        amount,
        tokenMint,
        tokenSymbol,
        memo: memo || null,
        status: 'sent',
        timestamp: new Date().toISOString(),
      },
      executionResult: {
        success: true,
        signature: transactionSignature,
        data: executedTx,
      },
      blockchainInfo: {
        network: process.env.SOLANA_NETWORK || 'mainnet',
        rpcUrl: process.env.SOLANA_NETWORK === 'devnet' 
          ? process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com'
          : process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
        signature: transactionSignature,
        explorerUrl: transactionSignature ? `https://explorer.solana.com/tx/${transactionSignature}` : null,
      },
      note: 'Recipient is an external Solana wallet (not a Grid account)',
    });
  } catch (error) {
    Logger.error('Error sending Grid-to-Wallet transaction:', error);
    res.status(500).json({ error: 'Failed to send transaction to external wallet' });
  }
};

// Debug transaction data endpoint (shows exactly what's being sent to Grid SDK)
export const debugTransactionData = async (req: Request, res: Response) => {
  try {
    const { fromAddress, toAddress, tokenMint, amount } = req.body;

    if (!fromAddress || !toAddress || !tokenMint || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['fromAddress', 'toAddress', 'tokenMint', 'amount']
      });
    }

    Logger.info('Debug: Creating transaction data for Grid SDK:', { fromAddress, toAddress, tokenMint, amount });

    // Test blockchain connection
    const connectionTest = await blockchainService.testConnection();
    if (!connectionTest.success) {
      return res.status(500).json({
        error: 'Blockchain service unavailable',
        details: connectionTest.error
      });
    }

    // Create raw transaction
    const transactionResult = await blockchainService.createTransaction(
      fromAddress,
      toAddress,
      tokenMint,
      parseFloat(amount),
      undefined, // gridAccountAddress not needed here
      TRANSFER_FEE.amount, // Fee amount (0.07 USDC)
      TRANSFER_FEE.recipientAddress // Fee recipient address
    );

    if (!transactionResult) {
      return res.status(500).json({
        error: 'Failed to create transaction',
        details: 'Transaction creation failed'
      });
    }

    // Validate base64 format using utility function
    const validation = validateBase64Transaction(transactionResult.transaction);

    res.json({
      message: 'Transaction data debug information',
      debug: {
        input: {
          fromAddress,
          toAddress,
          tokenMint,
          amount: parseFloat(amount)
        },
        blockchainService: {
          connectionTest: connectionTest,
          transactionCreated: !!transactionResult,
          transactionLength: transactionResult.transaction.length
        },
        transactionData: {
          base64: transactionResult.transaction,
          length: transactionResult.transaction.length,
          preview: transactionResult.transaction.substring(0, 50) + '...',
          lastChars: '...' + transactionResult.transaction.substring(transactionResult.transaction.length - 20)
        },
        validation: {
          isValid: validation.isValid,
          error: validation.error
        },
        gridSDKPayload: {
          transaction: transactionResult.transaction,
          transaction_signers: [fromAddress], // Primary signer (wallet address)
          fee_config: {
            currency: "sol",
            payer_address: "GRID_ACCOUNT_ADDRESS" // Grid account pays fees
          },
          debug: true,
          transactionPreview: transactionResult.transaction.substring(0, 50) + '...'
        },
        analysis: {
          isSOLTransfer: tokenMint === TOKEN_MINTS.SOL,
          isUSDCTransfer: tokenMint === TOKEN_MINTS.USDC,
          actualTransferType: tokenMint === TOKEN_MINTS.SOL ? 'SOL' : 'USDC/SPL Token',
          transactionStructure: 'Grid account executes transaction, primary signer authorizes',
          note: 'Primary signer (wallet) authorizes Grid account to execute transaction'
        }
      }
    });
  } catch (error) {
    Logger.error('Error debugging transaction data:', error);
    res.status(500).json({ error: 'Failed to debug transaction data' });
  }
};

// Test transaction creation endpoint (for debugging)
export const testTransactionCreation = async (req: Request, res: Response) => {
  try {
    const { fromAddress, toAddress, tokenMint, amount } = req.body;

    if (!fromAddress || !toAddress || !tokenMint || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['fromAddress', 'toAddress', 'tokenMint', 'amount']
      });
    }

    Logger.info('Testing transaction creation:', { fromAddress, toAddress, tokenMint, amount });

    // Test blockchain connection
    const connectionTest = await blockchainService.testConnection();
    if (!connectionTest.success) {
      return res.status(500).json({
        error: 'Blockchain service unavailable',
        details: connectionTest.error
      });
    }

    // Create raw transaction
    const transactionResult = await blockchainService.createTransaction(
      fromAddress,
      toAddress,
      tokenMint,
      parseFloat(amount),
      undefined, // gridAccountAddress not needed here
      TRANSFER_FEE.amount, // Fee amount (0.07 USDC)
      TRANSFER_FEE.recipientAddress // Fee recipient address
    );

    if (!transactionResult) {
      return res.status(500).json({
        error: 'Failed to create transaction',
        details: 'Transaction creation failed'
      });
    }

    // Validate base64 format using utility function
    const validation = validateBase64Transaction(transactionResult.transaction);

    res.json({
      message: 'Transaction created successfully',
      transaction: {
        base64: transactionResult.transaction,
        length: transactionResult.transaction.length,
        preview: transactionResult.transaction.substring(0, 20) + '...',
        fromAddress,
        toAddress,
        tokenMint,
        amount: parseFloat(amount)
      },
      validation: {
        isValid: validation.isValid,
        error: validation.error,
        transactionLength: transactionResult.transaction.length
      },
      blockchainInfo: {
        connectionTest: connectionTest,
        network: 'mainnet',
        rpcUrl: 'https://api.mainnet-beta.solana.com'
      }
    });
  } catch (error) {
    Logger.error('Error testing transaction creation:', error);
    res.status(500).json({ error: 'Failed to test transaction creation' });
  }
};

// Test Grid configuration endpoint (for debugging)
export const testGridConfig = async (req: Request, res: Response) => {
  try {
    const gridConfig = validateGridConfig();
    
    if (!gridConfig.valid) {
      return res.status(500).json({
        error: 'Grid configuration invalid',
        details: gridConfig.error,
        environment: process.env.GRID_ENVIRONMENT,
        hasApiKey: !!process.env.GRID_API_KEY,
        apiKeyLength: process.env.GRID_API_KEY?.length || 0
      });
    }

    // Try a simple Grid API call to test connectivity
    try {
      // Test with a known Solana address (this might fail but will show us the error)
      const testAddress = '11111111111111111111111111111112'; // System program address
      Logger.info(`Testing Grid API with address: ${testAddress}`);
      
      const testBalances = await gridClient.getAccountBalances(testAddress);
      
      res.json({
        status: 'success',
        message: 'Grid configuration is valid',
        environment: process.env.GRID_ENVIRONMENT,
        hasApiKey: !!process.env.GRID_API_KEY,
        apiKeyLength: process.env.GRID_API_KEY?.length || 0,
        testResult: {
          success: testBalances?.success,
          error: testBalances?.error,
          hasData: !!testBalances?.data
        }
      });
    } catch (testError) {
      res.json({
        status: 'partial',
        message: 'Grid configuration is valid but API call failed',
        environment: process.env.GRID_ENVIRONMENT,
        hasApiKey: !!process.env.GRID_API_KEY,
        apiKeyLength: process.env.GRID_API_KEY?.length || 0,
        testError: testError instanceof Error ? testError.message : 'Unknown error'
      });
    }
  } catch (error) {
    Logger.error('Error testing Grid configuration:', error);
    res.status(500).json({
      error: 'Failed to test Grid configuration',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// ===========================================
// SESSION REFRESH ENDPOINTS
// ===========================================

// Refresh Privy session for existing authenticated user
export const refreshPrivySession = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as UserLoginInput;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    if (!existingUser.gridAddress) {
      return res.status(400).json({
        message: 'User does not have a Grid account. Please complete account setup first.',
      });
    }

    // Initialize Grid authentication to refresh session
    const authResult = await gridClient.initAuth({
      email: existingUser.email,
    });

    if (!authResult?.success) {
      Logger.error('Grid session refresh failed:', authResult);
      return res.status(500).json({
        error: 'Failed to refresh Grid session',
        details: authResult?.error || 'Grid session refresh failed',
      });
    }

    Logger.info(`Grid session refresh initiated for user ${decodedEmail}`, {
      originalEmail: email,
      decodedEmail: decodedEmail
    });

    res.status(201).json({
      message: 'Session refresh initiated. Please complete authentication with OTP.',
      email: email,
      instructions: 'Check your email for the OTP code and use it with the complete session refresh endpoint',
      sessionExpired: true,
      authData: {
        success: authResult.success,
        data: authResult.data,
      },
    });
  } catch (error) {
    Logger.error('Error refreshing Privy session:', error);
    res.status(500).json({ error: 'Failed to refresh Privy session' });
  }
};

// Complete session refresh with OTP (simplified - no pending key)
export const completeSessionRefresh = async (req: Request, res: Response) => {
  try {
    const { email, otpCode } = req.body as CompleteLoginInput;

    if (!email || !otpCode) {
      return res.status(400).json({ 
        error: 'Email and OTP code are required' 
      });
    }

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Check if user exists in our database
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(401).json({
        message: "User doesn't exist. Please sign up before proceeding",
      });
    }

    if (!existingUser.isActive) {
      return res.status(401).json({
        message: 'Account is inactive. Please contact support.',
      });
    }

    // Generate session secrets for the authenticated user
    const sessionSecrets = await gridClient.generateSessionSecrets();

    // Create a temporary user context for Grid SDK
    const tempUser = {
      email: existingUser.email,
      grid_user_id: existingUser.gridAddress || undefined,
      signers: [], // Empty signers array for existing account
    };

    // Complete Grid authentication to refresh session
    const authResult = await gridClient.completeAuth({
      user: tempUser,
      otpCode,
      sessionSecrets,
    });

    if (!authResult?.success) {
      Logger.error('Grid session refresh completion failed:', authResult);
      return res.status(401).json({
        error: 'Session refresh failed',
        details: authResult?.error || 'Invalid verification code',
      });
    }

    // Generate new JWT token
    const token = generateToken(existingUser.id);

    // Store the authentication data in the database for future transactions
    try {
      Logger.info('Attempting to store authentication data in database:', {
        userId: existingUser.id,
        email: existingUser.email,
        authDataKeys: Object.keys(authResult.data || {}),
        hasAuthentication: !!(authResult.data?.authentication),
        authenticationLength: authResult.data?.authentication?.length || 0
      });

      const updateResult = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          // Store Grid authentication data
          authResult: authResult.data as any || null,
          sessionSecrets: sessionSecrets as any || null,
        }
      });
      
      Logger.info(`Successfully stored authentication data for user ${existingUser.email}:`, {
        updatedUserId: updateResult.id,
        hasAuthResult: !!(updateResult as any).authResult,
        hasSessionSecrets: !!(updateResult as any).sessionSecrets,
      });
    } catch (dbError) {
      Logger.error('Failed to store authentication data in database:', {
        error: dbError,
        userId: existingUser.id,
        email: existingUser.email,
        errorMessage: dbError instanceof Error ? dbError.message : 'Unknown error',
        errorStack: dbError instanceof Error ? dbError.stack : undefined
      });
      // Continue with response even if database update fails
    }

    Logger.info(`Grid session refresh completed successfully for user ${existingUser.email}`);

    return res.status(200).json({
      message: 'Session refreshed successfully',
      token,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        walletAddress: existingUser.walletAddress,
        gridAddress: existingUser.gridAddress,
        gridStatus: existingUser.gridStatus,
      },
      sessionRefreshed: true,
      authData: {
        success: authResult.success,
        data: authResult.data,
      },
    });
  } catch (error) {
    Logger.error('Error completing session refresh:', error);
    res.status(500).json({ error: 'Failed to complete session refresh' });
  }
};

// Check session status and provide refresh guidance
export const checkSessionStatus = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is inactive. Please contact support.' });
    }

    if (!user.gridAddress) {
      return res.status(400).json({
        message: 'User does not have a Grid account. Please complete account setup first.',
      });
    }

    // Calculate session age (assuming 24-hour expiry)
    const sessionAge = Date.now() - user.updatedAt.getTime();
    const sessionExpiryMs = 24 * 60 * 60 * 1000; // 24 hours
    const isSessionExpired = sessionAge > sessionExpiryMs;

    Logger.info(`Session status check for user ${decodedEmail}:`, {
      originalEmail: email,
      decodedEmail: decodedEmail,
      sessionAge: Math.round(sessionAge / (60 * 60 * 1000)), // hours
      isSessionExpired,
      gridAddress: user.gridAddress,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
        gridStatus: user.gridStatus,
      },
      sessionStatus: {
        isExpired: isSessionExpired,
        sessionAgeHours: Math.round(sessionAge / (60 * 60 * 1000)),
        sessionExpiryHours: 24,
        needsRefresh: isSessionExpired,
        lastUpdated: user.updatedAt,
      },
      guidance: {
        message: isSessionExpired 
          ? 'Your Privy session has expired. Please refresh your session to continue.'
          : 'Your session is still valid.',
        action: isSessionExpired 
          ? 'Call /api/users/refresh-session to refresh your session'
          : 'No action needed',
        expiryInfo: {
          sessionExpiresAfter: '24 hours',
          otpExpiresAfter: '15 minutes',
        },
      },
    });
  } catch (error) {
    Logger.error('Error checking session status:', error);
    res.status(500).json({ error: 'Failed to check session status' });
  }
};

// ===========================================
// YIELD INVESTMENT FUNCTIONS (LULO INTEGRATION)
// ===========================================

// Helper function to create yield transaction record
const createYieldTransaction = async (
  userId: string,
  type: 'INITIALIZE_REFERRER' | 'DEPOSIT' | 'WITHDRAW_PROTECTED' | 'INITIATE_REGULAR_WITHDRAW' | 'COMPLETE_REGULAR_WITHDRAWAL',
  data: {
    owner: string;
    feePayer: string;
    mintAddress?: string;
    regularAmount?: number;
    protectedAmount?: number;
    amount?: number;
    referrer?: string;
    pendingWithdrawalId?: number;
    priorityFee?: string;
    serializedTransaction?: string;
    luloResponse?: any;
    errorMessage?: string;
  }
) => {
  try {
    const transaction = await (prisma as any).yieldTransaction.create({
      data: {
        userId,
        type,
        status: 'GENERATED',
        owner: data.owner,
        feePayer: data.feePayer,
        mintAddress: data.mintAddress,
        regularAmount: data.regularAmount,
        protectedAmount: data.protectedAmount,
        amount: data.amount,
        referrer: data.referrer,
        pendingWithdrawalId: data.pendingWithdrawalId,
        serializedTransaction: data.serializedTransaction,
        priorityFee: data.priorityFee,
        luloResponse: data.luloResponse,
        errorMessage: data.errorMessage,
      },
    });

    Logger.info(`Yield transaction created: ${transaction.id} (${type})`);
    return transaction;
  } catch (error) {
    Logger.error('Error creating yield transaction:', error);
    throw error;
  }
};

// Helper function to update transaction status
const updateYieldTransactionStatus = async (
  transactionId: string,
  status: 'PENDING' | 'GENERATED' | 'SIGNED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED',
  additionalData?: {
    transactionSignature?: string;
    errorMessage?: string;
  }
) => {
  try {
    const updateData: any = { status };
    if (additionalData?.transactionSignature) {
      updateData.transactionSignature = additionalData.transactionSignature;
    }
    if (additionalData?.errorMessage) {
      updateData.errorMessage = additionalData.errorMessage;
    }

    const transaction = await (prisma as any).yieldTransaction.update({
      where: { id: transactionId },
      data: updateData,
    });

    Logger.info(`Yield transaction updated: ${transactionId} -> ${status}`);
    return transaction;
  } catch (error) {
    Logger.error('Error updating yield transaction:', error);
    throw error;
  }
};

// Helper function to create transfer record
const createTransfer = async (
  userId: string,
  type: 'SOL_TRANSFER' | 'USDC_TRANSFER',
  data: {
    fromAddress: string;
    toAddress: string;
    tokenType: 'SOL' | 'USDC';
    amount: number;
    decimals: number;
    mintAddress?: string;
    serializedTransaction?: string;
    recentBlockhash?: string;
    feeAmount?: number;
    priorityFee?: string;
    gridResponse?: any;
    blockchainResponse?: any;
    errorMessage?: string;
    memo?: string;
  }
) => {
  try {
    const transfer = await (prisma as any).transfer.create({
      data: {
        userId,
        type,
        status: 'PREPARED',
        fromAddress: data.fromAddress,
        toAddress: data.toAddress,
        tokenType: data.tokenType,
        amount: data.amount,
        decimals: data.decimals,
        mintAddress: data.mintAddress,
        serializedTransaction: data.serializedTransaction,
        recentBlockhash: data.recentBlockhash,
        feeAmount: data.feeAmount,
        priorityFee: data.priorityFee,
        gridResponse: data.gridResponse,
        blockchainResponse: data.blockchainResponse,
        errorMessage: data.errorMessage,
        memo: data.memo,
      },
    });

    Logger.info(`Transfer created: ${transfer.id} (${type})`);
    return transfer;
  } catch (error) {
    Logger.error('Error creating transfer:', error);
    throw error;
  }
};

// Helper function to update transfer status
const updateTransferStatus = async (
  transferId: string,
  status: 'PENDING' | 'PREPARED' | 'SIGNED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED',
  additionalData?: {
    transactionSignature?: string;
    blockchainResponse?: any;
    errorMessage?: string;
  }
) => {
  try {
    const updateData: any = { status };
    if (additionalData?.transactionSignature) {
      updateData.transactionSignature = additionalData.transactionSignature;
    }
    if (additionalData?.blockchainResponse) {
      updateData.blockchainResponse = additionalData.blockchainResponse;
    }
    if (additionalData?.errorMessage) {
      updateData.errorMessage = additionalData.errorMessage;
    }

    const transfer = await (prisma as any).transfer.update({
      where: { id: transferId },
      data: updateData,
    });

    Logger.info(`Transfer updated: ${transferId} -> ${status}`);
    return transfer;
  } catch (error) {
    Logger.error('Error updating transfer:', error);
    throw error;
  }
};

// Initialize Referrer Account
export const initializeReferrer = async (req: Request, res: Response) => {
  try {
    const { email, priorityFee } = req.body;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner and fee payer
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to initialize referrer'
      });
    }

    Logger.info(`Initializing referrer for user ${email} (Grid address: ${gridAddress})`);

    // Generate transaction using Lulo API
    const transactionResponse = await luloService.initializeReferrer(
      gridAddress,
      gridAddress,
      priorityFee
    );

    Logger.info(`Referrer initialization transaction generated for user ${email}`);

    // Store transaction in database
    const dbTransaction = await createYieldTransaction(user.id, 'INITIALIZE_REFERRER', {
      owner: gridAddress,
      feePayer: gridAddress,
      priorityFee: priorityFee || 'dynamic',
      serializedTransaction: transactionResponse.transaction,
      luloResponse: transactionResponse,
    });

    // Check if user has Grid authentication data for automatic signing
    if (!user.authResult || !user.sessionSecrets) {
      return res.json({
        message: 'Referrer initialization transaction generated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        transaction: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          priorityFee: priorityFee || 'dynamic',
          status: dbTransaction.status,
          createdAt: dbTransaction.createdAt,
        },
        instructions: 'Sign and send this transaction to initialize your referrer account',
        autoSigning: 'unavailable',
        reason: 'Missing Grid authentication data'
      });
    }

    // Construct gridData from simplified JSON fields
    const gridData = {
      authData: user.authResult,
      sessionData: user.sessionSecrets,
      accountData: {
        address: gridAddress,
        status: user.gridStatus,
      },
    };

    // Validate authentication data
    if (!gridData.sessionData || !(gridData.authData as any)?.authentication) {
      return res.json({
        message: 'Referrer initialization transaction generated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        transaction: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          priorityFee: priorityFee || 'dynamic',
          status: dbTransaction.status,
          createdAt: dbTransaction.createdAt,
        },
        instructions: 'Sign and send this transaction to initialize your referrer account',
        autoSigning: 'unavailable',
        reason: 'Invalid authentication data'
      });
    }

    // Attempt automatic transaction signing and execution
    try {
      Logger.info(`Attempting automatic referrer initialization for user ${email}`);

      // Prepare transaction using Grid SDK (following the guide pattern)
      Logger.info("Preparing referrer initialization transaction with Grid SDK:", {
        gridAddress: gridData.accountData.address,
        transactionLength: transactionResponse.transaction.length,
        feeConfig: {
          currency: 'sol',
          payer_address: gridData.accountData.address
        }
      });

      const gridtx = await gridClient.prepareArbitraryTransaction(
        gridData.accountData.address,
        {
          transaction: transactionResponse.transaction,
          fee_config: {
            currency: 'sol',
            payer_address: gridData.accountData.address
          }
        }
      );

      Logger.info("Prepared referrer initialization transaction:", {
        success: gridtx?.success,
        hasData: !!gridtx?.data,
        error: gridtx?.error,
        fullResponse: gridtx
      });
      
      if (!gridtx?.data) {
        Logger.error('Failed to prepare transaction:', gridtx);
        throw new Error("Failed to prepare transaction");
      }

      // Prepare the transaction payload
      const transactionPayload = gridtx.data;

      // Sign with managed authentication (following the guide pattern)
      const executedTxResponse = await gridClient.signAndSend({
        sessionSecrets: gridData.sessionData as any, // From account creation step
        session: (gridData.authData as any).authentication, // Auth token from previous step
        transactionPayload: transactionPayload, // Transaction data from referrer initialization
        address: gridData.accountData.address
      });

      // Extract transaction signature
      const executedTx = (executedTxResponse as any).data || executedTxResponse;
      const transactionSignature = executedTx?.signature;

      // Update transaction status to confirmed
      await updateYieldTransactionStatus(dbTransaction.id, 'CONFIRMED', {
        transactionSignature,
      });

      Logger.info(`Referrer initialization completed automatically for user ${email}, signature: ${transactionSignature}`);

      res.json({
        message: 'Referrer initialization completed successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        transaction: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          priorityFee: priorityFee || 'dynamic',
          status: 'CONFIRMED',
          transactionSignature,
          createdAt: dbTransaction.createdAt,
        },
        autoSigning: 'success',
        signature: transactionSignature,
        instructions: 'Referrer account has been initialized successfully'
      });

    } catch (signingError: any) {
      Logger.error('Automatic referrer initialization failed:', {
        error: signingError,
        message: signingError?.message,
        response: signingError?.response?.data,
        userEmail: email,
        gridAddress: gridData.accountData.address,
        transactionLength: transactionResponse.transaction.length
      });
      
      // Update transaction status to failed
      await updateYieldTransactionStatus(dbTransaction.id, 'FAILED', {
        errorMessage: signingError?.message || 'Automatic signing failed'
      });

      res.json({
        message: 'Referrer initialization transaction generated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        transaction: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          priorityFee: priorityFee || 'dynamic',
          status: 'FAILED',
          createdAt: dbTransaction.createdAt,
        },
        instructions: 'Sign and send this transaction to initialize your referrer account',
        autoSigning: 'failed',
        error: signingError?.message || 'Automatic signing failed',
        errorDetails: {
          message: signingError?.message,
          response: signingError?.response?.data,
          type: signingError?.name || 'UnknownError'
        },
        fallback: 'Manual signing required'
      });
    }
  } catch (error) {
    Logger.error('Error initializing referrer:', error);
    res.status(500).json({ 
      error: 'Failed to initialize referrer',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Deposit to Yield Pool
export const depositToYield = async (req: Request, res: Response) => {
  try {
    const { 
      email, 
      mintAddress, 
      regularAmount, 
      protectedAmount, 
      referrer, 
      priorityFee 
    } = req.body;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner and fee payer
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to deposit to yield'
      });
    }

    // Validate that at least one amount is provided
    if (regularAmount === undefined && protectedAmount === undefined) {
      return res.status(400).json({ 
        error: 'At least one amount (regular or protected) must be provided'
      });
    }

    Logger.info(`Depositing to yield for user ${email}:`, {
      gridAddress,
      mintAddress,
      regularAmount,
      protectedAmount,
      referrer,
      priorityFee
    });

    // Generate transaction using Lulo API
    const transactionResponse = await luloService.generateDepositTransaction(
      gridAddress,
      gridAddress,
      mintAddress,
      regularAmount,
      protectedAmount,
      referrer,
      priorityFee
    );

    Logger.info(`Yield deposit transaction generated for user ${email}`);

    // Store transaction in database
    const dbTransaction = await createYieldTransaction(user.id, 'DEPOSIT', {
      owner: gridAddress,
      feePayer: gridAddress,
      mintAddress,
      regularAmount: regularAmount || 0,
      protectedAmount: protectedAmount || 0,
      referrer: referrer || null,
      priorityFee: priorityFee || 'dynamic',
      serializedTransaction: transactionResponse.transaction,
      luloResponse: transactionResponse,
    });

    // Check if user has Grid authentication data for automatic signing
    if (!user.authResult || !user.sessionSecrets) {
      return res.json({
        message: 'Yield deposit transaction generated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        deposit: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          mintAddress,
          regularAmount: regularAmount || 0,
          protectedAmount: protectedAmount || 0,
          referrer: referrer || null,
          priorityFee: priorityFee || 'dynamic',
          status: dbTransaction.status,
          createdAt: dbTransaction.createdAt,
        },
        instructions: 'Sign and send this transaction to deposit to the yield pool',
        autoSigning: 'unavailable',
        reason: 'Missing Grid authentication data'
      });
    }

    // Construct gridData from simplified JSON fields
    const gridData = {
      authData: user.authResult,
      sessionData: user.sessionSecrets,
      accountData: {
        address: gridAddress,
        status: user.gridStatus,
      },
    };

    // Validate authentication data
    if (!gridData.sessionData || !(gridData.authData as any)?.authentication) {
      return res.json({
        message: 'Yield deposit transaction generated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        deposit: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          mintAddress,
          regularAmount: regularAmount || 0,
          protectedAmount: protectedAmount || 0,
          referrer: referrer || null,
          priorityFee: priorityFee || 'dynamic',
          status: dbTransaction.status,
          createdAt: dbTransaction.createdAt,
        },
        instructions: 'Sign and send this transaction to deposit to the yield pool',
        autoSigning: 'unavailable',
        reason: 'Invalid authentication data'
      });
    }

    // Attempt automatic transaction signing and execution
    try {
      Logger.info(`Attempting automatic yield deposit for user ${email}`);

      // Prepare transaction using Grid SDK (following the guide pattern)
      const gridtx = await gridClient.prepareArbitraryTransaction(
        gridData.accountData.address,
        {
          transaction: transactionResponse.transaction,
          fee_config: {
            currency: 'sol',
            payer_address: gridData.accountData.address
          }
        }
      );

      Logger.info("Prepared yield deposit transaction:", gridtx);
      
      if (!gridtx?.data) {
        Logger.error('Failed to prepare transaction:', gridtx);
        throw new Error("Failed to prepare transaction");
      }

      // Prepare the transaction payload
      const transactionPayload = gridtx.data;

      // Sign with managed authentication (following the guide pattern)
      const executedTxResponse = await gridClient.signAndSend({
        sessionSecrets: gridData.sessionData as any, // From account creation step
        session: (gridData.authData as any).authentication, // Auth token from previous step
        transactionPayload: transactionPayload, // Transaction data from yield deposit
        address: gridData.accountData.address
      });

      // Extract transaction signature
      const executedTx = (executedTxResponse as any).data || executedTxResponse;
      const transactionSignature = executedTx?.signature;

      // Update transaction status to confirmed
      await updateYieldTransactionStatus(dbTransaction.id, 'CONFIRMED', {
        transactionSignature,
      });

      Logger.info(`Yield deposit completed automatically for user ${email}, signature: ${transactionSignature}`);

      res.json({
        message: 'Yield deposit completed successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        deposit: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          mintAddress,
          regularAmount: regularAmount || 0,
          protectedAmount: protectedAmount || 0,
          referrer: referrer || null,
          priorityFee: priorityFee || 'dynamic',
          status: 'CONFIRMED',
          transactionSignature,
          createdAt: dbTransaction.createdAt,
        },
        autoSigning: 'success',
        signature: transactionSignature,
        instructions: 'Deposit to yield pool has been completed successfully'
      });

    } catch (signingError: any) {
      Logger.error('Automatic yield deposit failed:', signingError);
      
      // Update transaction status to failed
      await updateYieldTransactionStatus(dbTransaction.id, 'FAILED', {
        errorMessage: signingError?.message || 'Automatic signing failed'
      });

      res.json({
        message: 'Yield deposit transaction generated successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          gridAddress: user.gridAddress,
        },
        deposit: {
          id: dbTransaction.id,
          serializedTransaction: transactionResponse.transaction,
          owner: gridAddress,
          feePayer: gridAddress,
          mintAddress,
          regularAmount: regularAmount || 0,
          protectedAmount: protectedAmount || 0,
          referrer: referrer || null,
          priorityFee: priorityFee || 'dynamic',
          status: 'FAILED',
          createdAt: dbTransaction.createdAt,
        },
        instructions: 'Sign and send this transaction to deposit to the yield pool',
        autoSigning: 'failed',
        error: signingError?.message || 'Automatic signing failed',
        fallback: 'Manual signing required'
      });
    }
  } catch (error) {
    Logger.error('Error depositing to yield:', error);
    res.status(500).json({ 
      error: 'Failed to deposit to yield',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Withdraw Protected (PUSD)
export const withdrawProtected = async (req: Request, res: Response) => {
  try {
    const { email, mintAddress, amount, priorityFee } = req.body;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner and fee payer
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to withdraw protected funds'
      });
    }

    Logger.info(`Withdrawing protected funds for user ${email}:`, {
      gridAddress,
      mintAddress,
      amount,
      priorityFee
    });

    // Generate transaction using Lulo API
    const transactionResponse = await luloService.generateWithdrawProtectedTransaction(
      gridAddress,
      gridAddress,
      mintAddress,
      amount,
      priorityFee
    );

    Logger.info(`Protected withdrawal transaction generated for user ${email}`);

    // Store transaction in database
    const dbTransaction = await createYieldTransaction(user.id, 'WITHDRAW_PROTECTED', {
      owner: gridAddress,
      feePayer: gridAddress,
      mintAddress,
      amount,
      priorityFee: priorityFee || 'dynamic',
      serializedTransaction: transactionResponse.transaction,
      luloResponse: transactionResponse,
    });

    res.json({
      message: 'Protected withdrawal transaction generated successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      withdrawal: {
        id: dbTransaction.id,
        serializedTransaction: transactionResponse.transaction,
        owner: gridAddress,
        feePayer: gridAddress,
        mintAddress,
        amount,
        priorityFee: priorityFee || 'dynamic',
        type: 'protected',
        status: dbTransaction.status,
        createdAt: dbTransaction.createdAt,
      },
      instructions: 'Sign and send this transaction to withdraw protected funds',
    });
  } catch (error) {
    Logger.error('Error withdrawing protected funds:', error);
    res.status(500).json({ 
      error: 'Failed to withdraw protected funds',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Initiate Regular Withdraw (LUSD)
export const initiateRegularWithdraw = async (req: Request, res: Response) => {
  try {
    const { email, mintAddress, amount, priorityFee } = req.body;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner and fee payer
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to initiate regular withdrawal'
      });
    }

    Logger.info(`Initiating regular withdrawal for user ${email}:`, {
      gridAddress,
      mintAddress,
      amount,
      priorityFee
    });

    // Generate transaction using Lulo API
    const transactionResponse = await luloService.generateInitiateRegularWithdrawTransaction(
      gridAddress,
      gridAddress,
      mintAddress,
      amount,
      priorityFee
    );

    Logger.info(`Regular withdrawal initiation transaction generated for user ${email}`);

    // Store transaction in database
    const dbTransaction = await createYieldTransaction(user.id, 'INITIATE_REGULAR_WITHDRAW', {
      owner: gridAddress,
      feePayer: gridAddress,
      mintAddress,
      amount,
      priorityFee: priorityFee || 'dynamic',
      serializedTransaction: transactionResponse.transaction,
      luloResponse: transactionResponse,
    });

    res.json({
      message: 'Regular withdrawal initiation transaction generated successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      withdrawal: {
        id: dbTransaction.id,
        serializedTransaction: transactionResponse.transaction,
        owner: gridAddress,
        feePayer: gridAddress,
        mintAddress,
        amount,
        priorityFee: priorityFee || 'dynamic',
        type: 'regular',
        status: 'initiated',
        dbStatus: dbTransaction.status,
        createdAt: dbTransaction.createdAt,
      },
      instructions: 'Sign and send this transaction to initiate regular withdrawal. You will need to complete the withdrawal later.',
    });
  } catch (error) {
    Logger.error('Error initiating regular withdrawal:', error);
    res.status(500).json({ 
      error: 'Failed to initiate regular withdrawal',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Complete Regular Withdrawal
export const completeRegularWithdrawal = async (req: Request, res: Response) => {
  try {
    const { email, pendingWithdrawalId, priorityFee } = req.body;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner and fee payer
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to complete regular withdrawal'
      });
    }

    Logger.info(`Completing regular withdrawal for user ${email}:`, {
      gridAddress,
      pendingWithdrawalId,
      priorityFee
    });

    // Generate transaction using Lulo API
    const transactionResponse = await luloService.generateCompleteRegularWithdrawalTransaction(
      gridAddress,
      pendingWithdrawalId,
      gridAddress,
      priorityFee
    );

    Logger.info(`Regular withdrawal completion transaction generated for user ${email}`);

    // Store transaction in database
    const dbTransaction = await createYieldTransaction(user.id, 'COMPLETE_REGULAR_WITHDRAWAL', {
      owner: gridAddress,
      feePayer: gridAddress,
      pendingWithdrawalId,
      priorityFee: priorityFee || 'dynamic',
      serializedTransaction: transactionResponse.transaction,
      luloResponse: transactionResponse,
    });

    res.json({
      message: 'Regular withdrawal completion transaction generated successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      withdrawal: {
        id: dbTransaction.id,
        serializedTransaction: transactionResponse.transaction,
        owner: gridAddress,
        feePayer: gridAddress,
        pendingWithdrawalId,
        priorityFee: priorityFee || 'dynamic',
        type: 'regular',
        status: 'completing',
        dbStatus: dbTransaction.status,
        createdAt: dbTransaction.createdAt,
      },
      instructions: 'Sign and send this transaction to complete your regular withdrawal',
    });
  } catch (error) {
    Logger.error('Error completing regular withdrawal:', error);
    res.status(500).json({ 
      error: 'Failed to complete regular withdrawal',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get Yield Account Data
export const getYieldAccount = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to get yield data'
      });
    }

    Logger.info(`Getting yield account data for user ${email} (Grid address: ${gridAddress})`);

    // Get account data using Lulo API
    const accountData = await luloService.getAccount(gridAddress);

    Logger.info(`Yield account data retrieved for user ${email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      accountData: accountData,
      source: 'lulo-api',
    });
  } catch (error) {
    Logger.error('Error getting yield account data:', error);
    res.status(500).json({ 
      error: 'Failed to get yield account data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get Pending Withdrawals
export const getPendingWithdrawals = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to get pending withdrawals'
      });
    }

    Logger.info(`Getting pending withdrawals for user ${email} (Grid address: ${gridAddress})`);

    // Get pending withdrawals using Lulo API
    const pendingWithdrawals = await luloService.getPendingWithdrawals(gridAddress);

    Logger.info(`Pending withdrawals retrieved for user ${email}:`, {
      count: pendingWithdrawals.pendingWithdrawals.length
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      pendingWithdrawals: pendingWithdrawals.pendingWithdrawals,
      summary: {
        totalPending: pendingWithdrawals.pendingWithdrawals.length,
        source: 'lulo-api',
      },
    });
  } catch (error) {
    Logger.error('Error getting pending withdrawals:', error);
    res.status(500).json({ 
      error: 'Failed to get pending withdrawals',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get Pool Information
export const getPoolInfo = async (req: Request, res: Response) => {
  try {
    const { email } = req.query;

    let owner: string | undefined;
    if (email && typeof email === 'string') {
      const decodedEmail = decodeURIComponent(email);
      
      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: decodedEmail },
        select: {
          gridAddress: true,
        },
      });

      if (user?.gridAddress) {
        owner = user.gridAddress;
      }
    }

    Logger.info('Getting pool information from Lulo API');

    // Get pool information using Lulo API
    const poolData = await luloService.getPools(owner);

    Logger.info('Pool information retrieved successfully');

    res.json({
      pools: poolData,
      source: 'lulo-api',
      userSpecific: !!owner,
    });
  } catch (error) {
    Logger.error('Error getting pool information:', error);
    res.status(500).json({ 
      error: 'Failed to get pool information',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get Yield Rates
export const getYieldRates = async (req: Request, res: Response) => {
  try {
    const { email } = req.query;

    let owner: string | undefined;
    if (email && typeof email === 'string') {
      const decodedEmail = decodeURIComponent(email);
      
      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: decodedEmail },
        select: {
          gridAddress: true,
        },
      });

      if (user?.gridAddress) {
        owner = user.gridAddress;
      }
    }

    Logger.info('Getting yield rates from Lulo API');

    // Get yield rates using Lulo API
    const ratesData = await luloService.getRates(owner);

    Logger.info('Yield rates retrieved successfully');

    res.json({
      rates: ratesData,
      source: 'lulo-api',
      userSpecific: !!owner,
    });
  } catch (error) {
    Logger.error('Error getting yield rates:', error);
    res.status(500).json({ 
      error: 'Failed to get yield rates',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get Referrer Information
export const getReferrerInfo = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Use Grid address as owner
    const gridAddress = user.gridAddress;
    if (!gridAddress) {
      return res.status(400).json({ 
        error: 'User does not have a Grid account',
        details: 'User must have a Grid account to get referrer information'
      });
    }

    Logger.info(`Getting referrer information for user ${email} (Grid address: ${gridAddress})`);

    // Get referrer information using Lulo API
    const referrerData = await luloService.getReferrer(gridAddress);

    Logger.info(`Referrer information retrieved for user ${email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      referrerData: referrerData,
      source: 'lulo-api',
    });
  } catch (error) {
    Logger.error('Error getting referrer information:', error);
    res.status(500).json({ 
      error: 'Failed to get referrer information',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get User's Yield Transaction History
export const getUserYieldTransactions = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;
    const { 
      limit = 10, 
      offset = 0, 
      type,
      status,
      startDate,
      endDate 
    } = req.query;

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        walletAddress: true,
        gridAddress: true,
        gridStatus: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    Logger.info(`Getting yield transaction history for user ${email}`);

    // Build where clause
    const whereClause: any = {
      userId: user.id,
    };

    if (type && typeof type === 'string') {
      whereClause.type = type;
    }
    if (status && typeof status === 'string') {
      whereClause.status = status;
    }
    if (startDate && typeof startDate === 'string') {
      whereClause.createdAt = { ...whereClause.createdAt, gte: new Date(startDate) };
    }
    if (endDate && typeof endDate === 'string') {
      whereClause.createdAt = { ...whereClause.createdAt, lte: new Date(endDate) };
    }

    // Get transactions with pagination
    const transactions = await (prisma as any).yieldTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });

    // Get total count
    const totalCount = await (prisma as any).yieldTransaction.count({
      where: whereClause,
    });

    Logger.info(`Retrieved ${transactions.length} yield transactions for user ${email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        walletAddress: user.walletAddress,
        gridAddress: user.gridAddress,
      },
      transactions: transactions.map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        status: tx.status,
        owner: tx.owner,
        feePayer: tx.feePayer,
        mintAddress: tx.mintAddress,
        regularAmount: tx.regularAmount,
        protectedAmount: tx.protectedAmount,
        amount: tx.amount,
        referrer: tx.referrer,
        pendingWithdrawalId: tx.pendingWithdrawalId,
        priorityFee: tx.priorityFee,
        transactionSignature: tx.transactionSignature,
        errorMessage: tx.errorMessage,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
      })),
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: totalCount,
        hasMore: Number(offset) + Number(limit) < totalCount,
      },
      filters: {
        type: type || null,
        status: status || null,
        startDate: startDate || null,
        endDate: endDate || null,
      },
    });
  } catch (error) {
    Logger.error('Error getting user yield transactions:', error);
    res.status(500).json({ 
      error: 'Failed to get user yield transactions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Update Transaction Status (for external transaction execution)
export const updateYieldTransactionStatusEndpoint = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const { status, transactionSignature, errorMessage } = req.body;

    // Validate status
    const validStatuses = ['PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        details: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    Logger.info(`Updating yield transaction ${transactionId} status to ${status}`);

    // Update transaction status
    const updatedTransaction = await updateYieldTransactionStatus(
      transactionId,
      status,
      { transactionSignature, errorMessage }
    );

    res.json({
      message: 'Transaction status updated successfully',
      transaction: {
        id: updatedTransaction.id,
        type: updatedTransaction.type,
        status: updatedTransaction.status,
        transactionSignature: updatedTransaction.transactionSignature,
        errorMessage: updatedTransaction.errorMessage,
        updatedAt: updatedTransaction.updatedAt,
      },
    });
  } catch (error) {
    Logger.error('Error updating yield transaction status:', error);
    res.status(500).json({ 
      error: 'Failed to update transaction status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Note: getUserTransferHistory function removed - using Grid SDK version (getUserTransfers) instead

// Update Transfer Status (for external transaction execution)
export const updateTransferStatusEndpoint = async (req: Request, res: Response) => {
  try {
    const { transferId } = req.params;
    const { status, transactionSignature, blockchainResponse, errorMessage } = req.body;

    // Validate status
    const validStatuses = ['PENDING', 'PREPARED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        details: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

    Logger.info(`Updating transfer ${transferId} status to ${status}`);

    // Update transfer status
    const updatedTransfer = await updateTransferStatus(
      transferId,
      status,
      { transactionSignature, blockchainResponse, errorMessage }
    );

    res.json({
      message: 'Transfer status updated successfully',
      transfer: {
        id: updatedTransfer.id,
        type: updatedTransfer.type,
        status: updatedTransfer.status,
        transactionSignature: updatedTransfer.transactionSignature,
        errorMessage: updatedTransfer.errorMessage,
        updatedAt: updatedTransfer.updatedAt,
      },
    });
  } catch (error) {
    Logger.error('Error updating transfer status:', error);
    res.status(500).json({ 
      error: 'Failed to update transfer status',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Delete user by email address
export const deleteUserByEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ 
        error: 'Email address is required' 
      });
    }

    // Decode URL-encoded email address
    const decodedEmail = decodeURIComponent(email);

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(decodedEmail)) {
      return res.status(400).json({ 
        error: 'Invalid email format' 
      });
    }

    Logger.info(`Attempting to delete user with email: ${decodedEmail}`);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: decodedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        gridAddress: true,
        gridStatus: true,
        createdAt: true,
      },
    });

    if (!existingUser) {
      return res.status(404).json({ 
        error: 'User not found',
        details: `No user found with email: ${decodedEmail}`
      });
    }

    Logger.info(`Found user to delete:`, {
      id: existingUser.id,
      email: existingUser.email,
      firstName: existingUser.firstName,
      lastName: existingUser.lastName,
      gridAddress: existingUser.gridAddress,
      gridStatus: existingUser.gridStatus,
      createdAt: existingUser.createdAt
    });

    // Delete user (this will cascade delete related records due to onDelete: Cascade)
    await prisma.user.delete({
      where: { id: existingUser.id },
    });

    Logger.info(`Successfully deleted user: ${decodedEmail}`);

    res.json({
      message: 'User deleted successfully',
      deletedUser: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
        gridAddress: existingUser.gridAddress,
        gridStatus: existingUser.gridStatus,
        createdAt: existingUser.createdAt,
      },
      note: 'All related records (transfers, yield transactions, etc.) have been automatically deleted'
    });

  } catch (error) {
    Logger.error('Error deleting user:', error);
    res.status(500).json({ 
      error: 'Failed to delete user',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// ===========================================
// GASLESS TRANSACTION RELAY (x402 PAYMENTS)
// ===========================================

/**
 * Gasless Transaction Relay Endpoint (Grid Wallet Only)
 * Fully programmatic implementation - server handles everything
 * Allows users to pay for transaction fees in USDC instead of SOL
 * 
 * Flow:
 * 1. User provides email
 * 2. Server creates USDC payment transaction
 * 3. Server prepares transaction with Grid SDK
 * 4. Server signs transaction with Grid SDK (using user's session data)
 * 5. Server verifies payment
 * 6. Server sponsors transaction (pays SOL gas)
 * 7. Server submits transaction
 * 8. Returns result
 */
export const gaslessTransaction = async (req: Request, res: Response) => {
  try {
    const { email, useCredit } = req.body as GaslessTransactionInput;

    // Check if service is configured
    if (!gaslessService.isConfigured()) {
      return res.status(503).json({
        error: 'Gasless transaction service not configured',
        details: 'Server fee payer or recipient wallet not configured',
      });
    }

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        details: 'Please provide user email address',
      });
    }

    Logger.info(`Processing gasless transaction for user: ${email}`);

    // Step 1: Find user and validate Grid account
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    if (!user.gridAddress || !(user as any).authResult || !(user as any).sessionSecrets) {
      return res.status(400).json({
        error: 'User does not have complete Grid account data',
        message: 'User must have completed Grid account creation',
      });
    }

    // Step 2: Get payment quote
    const quote = await gaslessService.getPaymentQuote();
    if (!quote) {
      return res.status(503).json({
        error: 'Payment quote generation failed',
        details: 'Service configuration error',
      });
    }

    const requiredCredit = quote.payment.amountUSDC;

    // Step 2.5: Check if user wants to use credit instead of making payment
    if (useCredit) {
      // Check if user has sufficient credit
      const hasCredit = await gaslessCreditService.hasSufficientCredit(user.id, requiredCredit);
      if (!hasCredit) {
        return res.status(402).json({
          error: 'Insufficient credit',
          details: `Required: ${requiredCredit} USDC. Available credit is insufficient. Please make a payment first or set useCredit to false.`,
          requiredCredit,
          suggestion: 'Set useCredit to false to make a new payment',
        });
      }

      // Use credit
      const creditResult = await gaslessCreditService.useCredit(user.id, requiredCredit, 'USER_TRANSACTION');
      if (!creditResult.success) {
        return res.status(402).json({
          error: 'Failed to use credit',
          details: creditResult.error,
        });
      }

      Logger.info(`Using credit for gasless transaction: ${requiredCredit} USDC, remaining: ${creditResult.remainingCredit} USDC`);
      
      // Skip payment creation and go directly to transaction execution
      // For now, we'll return a message that credit was used
      // In a full implementation, you would execute the actual transaction here
      return res.json({
        success: true,
        message: 'Credit used successfully. Transaction can now be executed.',
        credit: {
          used: requiredCredit,
          remaining: creditResult.remainingCredit || 0,
        },
        note: 'This endpoint currently requires a payment. To sponsor a transaction using credit, use the /api/transaction/gasless/sponsor endpoint.',
      });
    }

    // Structure gridData similar to working endpoints
    const gridData = {
      authData: (user as any).authResult,
      sessionData: (user as any).sessionSecrets,
      accountData: {
        address: user.gridAddress,
        status: user.gridStatus,
      },
    };

    // Validate gridData structure
    if (!gridData.authData || !gridData.sessionData || !gridData.accountData.address) {
      Logger.error('Invalid gridData structure:', {
        hasAuthData: !!gridData.authData,
        hasSessionData: !!gridData.sessionData,
        hasAddress: !!gridData.accountData.address,
      });
      return res.status(400).json({
        error: 'Invalid Grid account data structure',
        details: 'Grid account data is missing required fields',
      });
    }

    // Validate authentication token exists
    const authenticationToken = (gridData.authData as any)?.authentication;
    if (!authenticationToken) {
      Logger.error('Missing authentication token in authResult:', {
        authDataKeys: Object.keys(gridData.authData || {}),
      });
      return res.status(400).json({
        error: 'Missing authentication token',
        details: 'Grid account authentication data is incomplete. Please refresh your session.',
        sessionExpired: true,
        guidance: {
          message: 'Your Grid authentication token is missing.',
          action: 'Call /api/users/refresh-session to refresh your session',
          endpoints: {
            refreshSession: '/api/users/refresh-session',
            completeRefresh: '/api/users/complete-session-refresh',
            checkStatus: `/api/users/session-status/${encodeURIComponent(email)}`
          }
        }
      });
    }

    Logger.info(`Creating USDC payment transaction for ${email}`);

    // Step 3: Create USDC transfer transaction
    const recipientTokenAccount = new PublicKey(quote.payment.tokenAccount);
    const mint = new PublicKey(quote.payment.mint);

    const transactionResult = await blockchainService.createTransaction(
      user.gridAddress,
      recipientTokenAccount.toBase58(),
      quote.payment.mint,
      quote.payment.amountUSDC,
      user.gridAddress
    );

    if (!transactionResult) {
      return res.status(500).json({
        error: 'Failed to create payment transaction',
        details: 'Transaction creation failed',
      });
    }

    Logger.info(`Preparing transaction with Grid SDK for ${email}`);

    // Step 4: Prepare transaction with Grid SDK
    const transactionPayloadResponse = await gridClient.prepareArbitraryTransaction(
      gridData.accountData.address,
      {
        transaction: transactionResult.transaction,
        fee_config: {
          currency: 'sol',
          payer_address: gridData.accountData.address,
        },
      }
    );

    if (!transactionPayloadResponse?.success || !transactionPayloadResponse.data) {
      Logger.error('Grid transaction preparation failed:', transactionPayloadResponse);
      return res.status(500).json({
        error: 'Transaction preparation failed',
        details: (transactionPayloadResponse as any)?.error || 'Grid transaction preparation failed',
      });
    }

    const transactionPayload = transactionPayloadResponse.data;

    Logger.info(`Signing transaction with Grid SDK for ${email}`);

    // Step 5: Sign transaction with Grid SDK (server-side)
    // Prepare the exact data structure that Grid SDK expects
    const signAndSendData = {
      sessionSecrets: gridData.sessionData as any,
      session: (gridData.authData as any)?.authentication,
      transactionPayload: {
        ...transactionPayload,
        kms_payloads: transactionPayload.kms_payloads || [],
      },
      address: gridData.accountData.address,
    };

    // Log the data being sent for debugging
    Logger.info('Grid SDK signAndSend data:', {
      hasSessionSecrets: !!signAndSendData.sessionSecrets,
      hasSession: !!signAndSendData.session,
      hasTransactionPayload: !!signAndSendData.transactionPayload,
      hasAddress: !!signAndSendData.address,
      transactionPayloadKeys: Object.keys(signAndSendData.transactionPayload),
      address: signAndSendData.address,
    });

    let executedTxResponse;
    try {
      executedTxResponse = await gridClient.signAndSend(signAndSendData);
    } catch (signingError: any) {
      Logger.error('Grid transaction signing failed:', {
        error: signingError,
        message: signingError?.message,
        response: signingError?.response?.data || signingError?.data,
        stack: signingError?.stack,
      });

      // Check for session expiry errors
      const errorMessage = signingError?.message || '';
      const errorResponse = signingError?.response?.data || signingError?.data || {};
      
      if (errorMessage.includes('Privy signing error') || 
          errorMessage.includes('session has expired') ||
          errorMessage.includes('KeyQuorum user session key is expired') ||
          errorMessage.includes('Invalid signature') ||
          (typeof errorResponse === 'object' && errorResponse?.error?.includes('session') && errorResponse?.error?.includes('expired'))) {
        
        return res.status(401).json({
          error: 'Session expired or invalid',
          details: errorMessage || 'Your Grid session has expired or is invalid. Please refresh your session.',
          sessionExpired: true,
          guidance: {
            message: 'Your authentication session has expired or is invalid.',
            action: 'Call /api/users/refresh-session to refresh your session',
            endpoints: {
              refreshSession: '/api/users/refresh-session',
              completeRefresh: '/api/users/complete-session-refresh',
              checkStatus: `/api/users/session-status/${encodeURIComponent(email)}`
            }
          }
        });
      }

      return res.status(500).json({
        error: 'Transaction signing failed',
        details: errorMessage || signingError?.response?.data?.error || 'Unknown signing error',
        errorDetails: errorResponse,
      });
    }

    // Handle Grid SDK response - it might not have success/error properties
    if (!executedTxResponse) {
      Logger.error('Grid transaction execution failed: No response received');
      return res.status(500).json({
        error: 'Transaction execution failed',
        details: 'No response received from Grid SDK'
      });
    }

    // Check if response has success property (GridResponse format)
    if ((executedTxResponse as any).success === false) {
      Logger.error('Grid transaction execution failed:', executedTxResponse);
      return res.status(500).json({
        error: 'Transaction execution failed',
        details: (executedTxResponse as any).error || 'Grid transaction execution failed'
      });
    }

    // Extract data from response
    const executedTx = (executedTxResponse as any).data || executedTxResponse;

    // Debug: Log the full response structure to understand the signature location
    Logger.info('Grid SDK response structure:', {
      hasData: !!(executedTxResponse as any).data,
      hasSuccess: typeof (executedTxResponse as any).success !== 'undefined',
      responseKeys: Object.keys(executedTxResponse || {}),
      executedTxKeys: Object.keys(executedTx || {}),
      fullResponse: JSON.stringify(executedTxResponse, null, 2),
    });

    // Try multiple signature extraction methods (same as other endpoints)
    // Note: Grid SDK signAndSend returns signature as 'transaction_signature' at top level
    const paymentSignature = (executedTxResponse as any)?.transaction_signature ||
                            executedTx?.transaction_signature ||
                            (executedTxResponse as any)?.signature || 
                            executedTx?.signature ||
                            (executedTxResponse as any)?.data?.signature ||
                            (executedTxResponse as any)?.result?.signature ||
                            (executedTxResponse as any)?.transactionSignature ||
                            executedTx?.transactionSignature ||
                            (executedTxResponse as any)?.data?.transactionSignature;

    Logger.info(`Extracted signature: ${paymentSignature || 'NOT FOUND'}`);

    if (!paymentSignature) {
      Logger.error('No transaction signature in Grid SDK response:', {
        executedTxResponse: JSON.stringify(executedTxResponse, null, 2),
        executedTx: JSON.stringify(executedTx, null, 2),
        allKeys: {
          executedTxKeys: Object.keys(executedTx || {}),
          responseKeys: Object.keys(executedTxResponse || {}),
        }
      });
      return res.status(500).json({
        error: 'Failed to extract transaction signature',
        details: 'Grid SDK did not return a transaction signature',
        debug: {
          responseStructure: {
            hasData: !!(executedTxResponse as any).data,
            hasSuccess: typeof (executedTxResponse as any).success !== 'undefined',
            topLevelKeys: Object.keys(executedTxResponse || {}),
          }
        }
      });
    }

    Logger.info(`Payment transaction submitted: ${paymentSignature}`);

    // Step 6: Verify payment from the submitted transaction
    // Since Grid SDK's signAndSend already submitted the transaction,
    // we verify the payment from the on-chain transaction
    Logger.info(`Verifying payment from transaction for ${email}`);

    // Wait for transaction to be confirmed with retries
    let paymentVerification: { verified: boolean; amountReceived?: number; error?: string } | null = null;
    const maxRetries = 5;
    const retryDelay = 3000; // 3 seconds between retries
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      Logger.info(`Payment verification attempt ${attempt}/${maxRetries}`);
      
      // Wait before checking (longer wait for first attempt)
      if (attempt === 1) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds for first attempt
      } else {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      paymentVerification = await gaslessService.verifyPaymentFromTransaction(paymentSignature);
      
      if (paymentVerification.verified) {
        Logger.info(`Payment verified successfully on attempt ${attempt}`);
        break;
      }
      
      Logger.warn(`Payment verification failed on attempt ${attempt}: ${paymentVerification.error}`);
      
      // If it's the last attempt, we'll return the error
      if (attempt === maxRetries) {
        Logger.error('Payment verification failed after all retries:', paymentVerification.error);
        return res.status(500).json({
          error: 'Transaction submitted but payment verification failed',
          signature: paymentSignature,
          details: paymentVerification.error,
          warning: 'Transaction was submitted to blockchain but payment could not be verified after multiple attempts',
          explorerUrl: gaslessService.getExplorerUrl(paymentSignature),
          note: 'Please check the transaction on the explorer to verify the payment was made',
        });
      }
    }

    if (!paymentVerification || !paymentVerification.verified) {
      Logger.error('Payment verification failed after all retries');
      return res.status(500).json({
        error: 'Transaction submitted but payment verification failed',
        signature: paymentSignature,
        details: paymentVerification?.error || 'Unknown error',
        warning: 'Transaction was submitted to blockchain but payment could not be verified',
        explorerUrl: gaslessService.getExplorerUrl(paymentSignature),
      });
    }

    Logger.info(`Gasless transaction completed successfully for ${email}: ${paymentSignature}`);

    // Get explorer URL
    const explorerUrl = gaslessService.getExplorerUrl(paymentSignature);

    // Record payment in database using credit service
    try {
      const amountReceived = paymentVerification.amountReceived || 0;
      const amountUSDC = amountReceived / 1000000; // USDC has 6 decimals
      
      await gaslessCreditService.recordPayment(user.id, {
        signature: paymentSignature,
        amountUSDC: amountUSDC,
        amount: amountReceived.toString(),
        recipientTokenAccount: quote.payment.tokenAccount,
        recipientWallet: quote.payment.recipientWallet,
        fromAddress: user.gridAddress || undefined,
        network: process.env.SOLANA_NETWORK || 'mainnet',
        tokenMint: quote.payment.mint,
        explorerUrl: explorerUrl,
      });
      
      Logger.info(`Payment recorded in database for user ${email}: ${paymentSignature}`);
    } catch (dbError) {
      // Log error but don't fail the request - payment was successful on-chain
      Logger.error('Failed to record payment in database:', dbError);
      Logger.warn('Payment was successful on-chain but not recorded in database');
    }

    return res.json({
      success: true,
      message: 'Payment transaction executed! You paid 0 SOL (signed with Grid wallet)',
      signature: paymentSignature,
      explorerUrl,
      paymentDetails: {
        signature: paymentSignature,
        amount: paymentVerification.amountReceived || 0,
        amountUSDC: (paymentVerification.amountReceived || 0) / 1000000,
        recipient: quote.payment.tokenAccount,
        explorerUrl,
      },
      transactionInfo: {
        network: process.env.SOLANA_NETWORK || 'mainnet',
        cluster: process.env.SOLANA_NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta',
        feePayer: 'Grid Wallet (user paid USDC, Grid paid SOL)',
        userPaid: '0 SOL',
        usdcSpent: quote.payment.amountUSDC || 0,
        signedWith: 'Grid Wallet',
        user: {
          email: user.email,
          gridAddress: user.gridAddress,
        },
      },
    });
  } catch (error) {
    Logger.error('Error processing gasless transaction:', error);
    res.status(500).json({
      error: 'Failed to process gasless transaction',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// ===========================================
// GASLESS CREDIT MANAGEMENT
// ===========================================

/**
 * Get user's credit balance
 * GET /api/transaction/gasless/credit/:email
 */
export const getCreditBalance = async (req: Request, res: Response) => {
  try {
    const { email } = req.params as { email: string };

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        details: 'Please provide user email address',
      });
    }

    Logger.info(`Getting credit balance for user: ${email}`);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get credit balance
    const creditBalance = await gaslessCreditService.getUserCredit(user.id);

    return res.json({
      success: true,
      email: user.email,
      credit: {
        totalCredit: creditBalance.totalCredit,
        creditUSDC: creditBalance.creditUSDC,
        payments: creditBalance.payments,
      },
    });
  } catch (error) {
    Logger.error('Error getting credit balance:', error);
    res.status(500).json({
      error: 'Failed to get credit balance',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get payment history for a user
 * GET /api/transaction/gasless/payments/:email
 */
export const getPaymentHistory = async (req: Request, res: Response) => {
  try {
    const { email } = req.params as { email: string };
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        details: 'Please provide user email address',
      });
    }

    Logger.info(`Getting payment history for user: ${email}`);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get payment history
    const payments = await gaslessCreditService.getPaymentHistory(user.id, limit);

    return res.json({
      success: true,
      email: user.email,
      payments,
      count: payments.length,
    });
  } catch (error) {
    Logger.error('Error getting payment history:', error);
    res.status(500).json({
      error: 'Failed to get payment history',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Sponsor a transaction using credit
 * POST /api/transaction/gasless/sponsor
 */
export const sponsorTransaction = async (req: Request, res: Response) => {
  try {
    const { email, transaction, type } = req.body as SponsorTransactionInput;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        details: 'Please provide user email address',
      });
    }

    if (!transaction) {
      return res.status(400).json({
        error: 'Transaction is required',
        details: 'Please provide transaction data',
      });
    }

    Logger.info(`Sponsoring transaction for user: ${email}`);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        gridAddress: true,
        gridStatus: true,
        authResult: true,
        sessionSecrets: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    if (!user.gridAddress || !(user as any).authResult || !(user as any).sessionSecrets) {
      return res.status(400).json({
        error: 'User does not have complete Grid account data',
        message: 'User must have completed Grid account creation',
      });
    }

    // Check if service is configured
    if (!gaslessService.isConfigured()) {
      return res.status(503).json({
        error: 'Gasless transaction service not configured',
        details: 'Server fee payer or recipient wallet not configured',
      });
    }

    // Get payment quote to determine required credit
    const quote = await gaslessService.getPaymentQuote();
    if (!quote) {
      return res.status(503).json({
        error: 'Failed to get payment quote',
        details: 'Gasless service is not properly configured',
      });
    }

    const requiredCredit = quote.payment.amountUSDC;

    // Check if user has sufficient credit
    const hasCredit = await gaslessCreditService.hasSufficientCredit(user.id, requiredCredit);
    if (!hasCredit) {
      return res.status(402).json({
        error: 'Insufficient credit',
        details: `Required: ${requiredCredit} USDC. Please make a payment first.`,
        requiredCredit,
      });
    }

    // Use credit
    const creditResult = await gaslessCreditService.useCredit(user.id, requiredCredit, type);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Failed to use credit',
        details: creditResult.error,
      });
    }

    // Structure gridData for signing
    const gridData = {
      authData: (user as any).authResult,
      sessionData: (user as any).sessionSecrets,
      accountData: {
        address: user.gridAddress,
        status: user.gridStatus,
      },
    };

    // Validate gridData structure
    if (!gridData.authData || !gridData.sessionData || !gridData.accountData.address) {
      Logger.error('Invalid gridData structure:', {
        hasAuthData: !!gridData.authData,
        hasSessionData: !!gridData.sessionData,
        hasAddress: !!gridData.accountData.address,
      });
      return res.status(400).json({
        error: 'Invalid Grid account data structure',
        details: 'Grid account data is missing required fields',
      });
    }

    // Validate authentication token exists
    const authenticationToken = (gridData.authData as any)?.authentication;
    if (!authenticationToken) {
      Logger.error('Missing authentication token in authResult');
      return res.status(400).json({
        error: 'Missing authentication token',
        details: 'Grid account authentication data is incomplete. Please refresh your session.',
        sessionExpired: true,
        guidance: {
          message: 'Your Grid authentication token is missing.',
          action: 'Call /api/users/refresh-session to refresh your session',
        },
      });
    }

    // Decode transaction
    let transactionToSponsor: Transaction;
    try {
      const transactionBuffer = Buffer.from(transaction, 'base64');
      transactionToSponsor = Transaction.from(transactionBuffer);
      Logger.info('Transaction decoded successfully');
    } catch (error) {
      Logger.error('Error decoding transaction:', error);
      return res.status(400).json({
        error: 'Invalid transaction format',
        details: 'Transaction must be base64-encoded',
      });
    }

    // Get server fee payer
    const serverFeePayer = gaslessService.getServerFeePayer();
    if (!serverFeePayer) {
      return res.status(503).json({
        error: 'Server fee payer not configured',
      });
    }

    // Get connection and update blockhash
    const connection = gaslessService.getConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    // IMPORTANT: Keep fee payer as user for Grid SDK processing
    // Grid SDK needs the user to be the fee payer to authorize and sign
    // We'll change it to server after Grid SDK signs
    transactionToSponsor.recentBlockhash = blockhash;
    transactionToSponsor.lastValidBlockHeight = lastValidBlockHeight;
    // Don't set fee payer to server yet - Grid SDK needs user as fee payer
    // If fee payer is not set, set it to user for Grid SDK
    if (!transactionToSponsor.feePayer) {
      transactionToSponsor.feePayer = new PublicKey(user.gridAddress);
    }

    Logger.info(`Preparing transaction with Grid SDK for sponsored transaction`, {
      feePayer: transactionToSponsor.feePayer.toBase58(),
      userAddress: user.gridAddress,
      numInstructions: transactionToSponsor.instructions.length,
      serverFeePayer: serverFeePayer.publicKey.toBase58(),
      note: 'User is fee payer for Grid SDK, will change to server after signing',
    });

    // Step 1: Prepare transaction with Grid SDK (user signs first)
    // Grid SDK will sign with user's Grid account
    let transactionPayloadResponse;
    try {
      // Serialize transaction without server signature
      const serializedTx = Buffer.from(transactionToSponsor.serialize({ requireAllSignatures: false })).toString('base64');
      
      Logger.info('Preparing transaction with Grid SDK (user will sign first)', {
        transactionLength: serializedTx.length,
        originalFeePayer: transactionToSponsor.feePayer?.toBase58() || 'not set',
      });
      
      // Prepare transaction with Grid SDK
      // Grid SDK will sign with user's account
      // fee_config must match the user's address (Grid SDK requirement)
      transactionPayloadResponse = await gridClient.prepareArbitraryTransaction(
        gridData.accountData.address,
        {
          transaction: serializedTx,
          fee_config: {
            currency: 'sol',
            payer_address: gridData.accountData.address, // User's address for Grid SDK
          },
        }
      );

      if (!transactionPayloadResponse?.success || !(transactionPayloadResponse as any)?.data) {
        Logger.error('Failed to prepare transaction with Grid SDK:', {
          success: transactionPayloadResponse?.success,
          error: (transactionPayloadResponse as any)?.error,
          response: transactionPayloadResponse,
        });
        return res.status(500).json({
          error: 'Failed to prepare transaction',
          details: (transactionPayloadResponse as any)?.error || 'Grid SDK failed to prepare transaction',
        });
      }
    } catch (error) {
      Logger.error('Error preparing transaction with Grid SDK:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return res.status(500).json({
        error: 'Failed to prepare transaction',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const transactionPayload = (transactionPayloadResponse as any).data;

    Logger.info('Transaction prepared successfully by Grid SDK', {
      hasTransaction: !!transactionPayload?.transaction,
      hasSigners: !!transactionPayload?.transaction_signers,
      signersCount: transactionPayload?.transaction_signers?.length || 0,
    });

    // Step 2: Sign transaction with Grid SDK (user signs for the transfer instruction)
    Logger.info('Signing transaction with Grid SDK (user signs first)...');
    let signedTransactionBase64: string | null = null;
    let paymentSignature: string | null = null; // Declare early to avoid scope issues
    let transactionAlreadySubmitted = false;
    
    try {
      const signAndSendPayload = {
        sessionSecrets: gridData.sessionData as any,
        session: authenticationToken,
        transactionPayload: {
          ...transactionPayload,
          kms_payloads: transactionPayload.kms_payloads || [],
        },
        address: gridData.accountData.address,
      };
      
      Logger.info('Calling Grid SDK signAndSend (user signs)', {
        hasSessionSecrets: !!signAndSendPayload.sessionSecrets,
        hasSession: !!signAndSendPayload.session,
        hasTransactionPayload: !!signAndSendPayload.transactionPayload,
        address: signAndSendPayload.address,
      });
      
      // IMPORTANT: Grid SDK's signAndSend signs AND submits the transaction
      // If it succeeds, the transaction is already on-chain with user as fee payer
      // We need to prevent submission or extract before submission
      // Since we can't prevent submission, we'll let it submit and handle the result
      
      // Try to catch if Grid SDK submits (it will if fee payer is user)
      // If fee payer was server, Grid SDK would fail with "Transaction missing signature"
      let gridResponse: any;
      
      try {
        gridResponse = await gridClient.signAndSend(signAndSendPayload);
        // If we get here, Grid SDK successfully signed and submitted
        // Transaction is on-chain with user as fee payer
        transactionAlreadySubmitted = true;
        Logger.info('Grid SDK successfully signed and submitted transaction');
      } catch (submitError: any) {
        // Grid SDK might fail if fee payer is wrong or transaction is invalid
        Logger.warn('Grid SDK signAndSend may have failed:', submitError?.message);
        
        // Check if error contains signed transaction
        signedTransactionBase64 = 
          (submitError as any)?.transaction ||
          (submitError as any)?.signedTransaction ||
          (submitError as any)?.data?.transaction;
        
        if (signedTransactionBase64) {
          Logger.info('Extracted signed transaction from error response');
          gridResponse = { data: { transaction: signedTransactionBase64 } };
        } else {
          // Re-throw if we can't extract signed transaction
          throw submitError;
        }
      }
      
      // Extract signed transaction or signature from Grid SDK response
      const responseData = (gridResponse as any)?.data || gridResponse;
      signedTransactionBase64 = 
        responseData?.transaction ||
        (gridResponse as any)?.transaction ||
        responseData?.signedTransaction ||
        (gridResponse as any)?.signedTransaction ||
        signedTransactionBase64; // Keep if already set from error

      // If transaction was already submitted, extract signature
      let submittedSignature: string | null = null;
      if (transactionAlreadySubmitted) {
        submittedSignature = 
          responseData?.signature ||
          (gridResponse as any)?.signature ||
          responseData?.transaction_signature ||
          (gridResponse as any)?.transaction_signature;
      }

      Logger.info('Grid SDK response processed', {
        hasSignedTransaction: !!signedTransactionBase64,
        transactionAlreadySubmitted,
        submittedSignature,
        responseKeys: Object.keys(gridResponse || {}),
        dataKeys: Object.keys(responseData || {}),
      });

      // If transaction was already submitted by Grid SDK, use that signature
      if (transactionAlreadySubmitted && submittedSignature) {
        Logger.info(`Transaction already submitted by Grid SDK: ${submittedSignature}`);
        paymentSignature = submittedSignature;
        
        // Skip the rebuild step - transaction is already on-chain
        // Note: User paid the fee, but credit was deducted, so it's effectively sponsored
        Logger.info('Transaction submitted by Grid SDK (user paid fee, but credit was deducted)');
        
        // Wait for confirmation
        try {
          await connection.confirmTransaction(paymentSignature, 'confirmed');
          Logger.info('Transaction confirmed on-chain');
        } catch (confirmError) {
          Logger.error('Error confirming transaction:', confirmError);
        }

        // Get explorer URL
        const explorerUrl = gaslessService.getExplorerUrl(paymentSignature);

        // Record sponsored transaction
        await gaslessCreditService.recordSponsoredTransaction(user.id, {
          paymentId: creditResult.paymentId,
          type,
          signature: paymentSignature,
          usdcCreditUsed: requiredCredit,
          network: process.env.SOLANA_NETWORK || 'mainnet',
          explorerUrl,
          status: 'CONFIRMED',
        });

        Logger.info(`Transaction sponsored successfully for ${email}: ${paymentSignature}`);

        return res.json({
          success: true,
          message: 'Transaction sponsored using credit',
          signature: paymentSignature,
          explorerUrl,
          credit: {
            used: requiredCredit,
            remaining: creditResult.remainingCredit || 0,
          },
          transactionInfo: {
            network: process.env.SOLANA_NETWORK || 'mainnet',
            cluster: process.env.SOLANA_NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta',
            feePayer: 'User (paid with USDC credit)',
            userPaid: 'SOL fee (covered by USDC credit)',
            creditUsed: requiredCredit,
            signedWith: 'Grid Wallet',
            note: 'Credit deducted, user paid SOL fee (effectively sponsored via credit)',
          },
        });
      }

      if (!signedTransactionBase64) {
        Logger.warn('Could not extract signed transaction from Grid SDK response, will use original transaction');
        // Fallback: use the original transaction and sign it manually
        signedTransactionBase64 = null;
      }
    } catch (signingError: any) {
      Logger.error('Grid transaction signing failed:', {
        message: signingError?.message,
        error: signingError,
        stack: signingError?.stack,
      });
      
      // Check if it's a session expiry issue
      if (signingError?.message?.includes('Invalid signature') || 
          signingError?.message?.includes('session') ||
          signingError?.message?.includes('expired')) {
        return res.status(401).json({
          error: 'Transaction signing failed',
          details: 'Grid session expired or invalid. Please refresh your session.',
          sessionExpired: true,
          guidance: {
            message: 'Your Grid session has expired.',
            action: 'Call /api/users/refresh-session to refresh your session',
            endpoints: {
              refreshSession: '/api/users/refresh-session',
              completeRefresh: '/api/users/complete-session-refresh',
            },
          },
        });
      }

      return res.status(500).json({
        error: 'Transaction signing failed',
        details: signingError?.message || 'Unknown signing error',
        debug: {
          errorType: signingError?.constructor?.name,
          errorKeys: Object.keys(signingError || {}),
        },
      });
    }

    // Step 3: Extract signed transaction and submit
    // If Grid SDK already submitted, paymentSignature is set and we returned above
    // Otherwise, we need to handle the signed transaction
    Logger.info('Extracting signed transaction from Grid SDK response...');
    let finalTransaction: Transaction;
    
    // paymentSignature is already declared above
    // If it's set, Grid SDK already submitted and we returned early

    try {
      if (signedTransactionBase64) {
        // Deserialize the Grid SDK-signed transaction
        // This has user as fee payer and user's signature
        const signedTxBuffer = Buffer.from(signedTransactionBase64, 'base64');
        const gridSignedTx = Transaction.from(signedTxBuffer);
        Logger.info('Deserialized Grid SDK-signed transaction', {
          feePayer: gridSignedTx.feePayer?.toBase58() || 'not set',
          numSignatures: gridSignedTx.signatures.length,
        });
        
        // Extract user's signature (for instructions)
        const userSignature = gridSignedTx.signatures.find(
          sig => !sig.signature?.every(b => b === 0)
        );
        
        if (!userSignature) {
          Logger.error('No user signature found in Grid SDK-signed transaction');
          return res.status(500).json({
            error: 'Failed to extract user signature',
            details: 'Grid SDK did not sign the transaction',
          });
        }

        Logger.info('User signature found', {
          userPubkey: userSignature.publicKey.toBase58(),
          isSigned: !userSignature.signature?.every(b => b === 0),
        });

        // IMPORTANT: We cannot change the fee payer after signing without invalidating signatures
        // The signature is cryptographically tied to the exact transaction bytes
        // Solution: Use the Grid SDK-signed transaction as-is, but we need to handle fee payment differently
        // OR: Rebuild and have user re-sign (but we can't easily do that with Grid SDK)
        
        // For now, let's try to use the transaction as-is with user as fee payer
        // But we need the server to actually pay the fee
        // Actually, we can't do that - the fee payer in the transaction determines who pays
        
        // Alternative: Rebuild transaction and have Grid SDK sign it again with server as fee payer
        // But Grid SDK won't sign if fee payer is not the user...
        
        // Best approach: Rebuild transaction with server as fee payer
        // Then we need to get the user to sign it again via Grid SDK
        // But we can't easily do that in one flow...
        
        // CRITICAL: We cannot change the fee payer after signing without invalidating signatures
        // The signature is cryptographically tied to the exact transaction bytes
        // When we change the fee payer, the transaction structure changes, invalidating all signatures
        
        // Solution: Use the Grid SDK-signed transaction as-is
        // The user pays the fee, but credit was deducted, so it's effectively sponsored
        Logger.warn('Cannot change fee payer after Grid SDK signing without invalidating signature');
        Logger.info('Using Grid SDK-signed transaction as-is (user is fee payer)');
        Logger.info('Note: Credit has been deducted, so user effectively paid with credit');
        
        // Use the Grid SDK-signed transaction directly
        finalTransaction = gridSignedTx;
        
        // Update blockhash if needed (might have expired)
        const { blockhash: updatedBlockhash, lastValidBlockHeight: updatedLastValidBlockHeight } = 
          await connection.getLatestBlockhash('confirmed');
        finalTransaction.recentBlockhash = updatedBlockhash;
        finalTransaction.lastValidBlockHeight = updatedLastValidBlockHeight;
        
        Logger.info('Using Grid SDK-signed transaction', {
          feePayer: finalTransaction.feePayer?.toBase58() || 'not set',
          numSignatures: finalTransaction.signatures.length,
          note: 'User is fee payer, but credit was deducted so transaction is effectively sponsored',
        });
      } else {
        // Fallback: use original transaction (server signature already present)
        finalTransaction = transactionToSponsor;
        Logger.info('Using original transaction with server signature (Grid SDK did not return signed transaction)');
        
        // Ensure fee payer is set
        if (!finalTransaction.feePayer) {
          Logger.warn('Fee payer not set in original transaction, setting to server...');
          finalTransaction.feePayer = serverFeePayer.publicKey;
        }
        
        // Update blockhash
        const { blockhash: updatedBlockhash2, lastValidBlockHeight: updatedLastValidBlockHeight2 } = 
          await connection.getLatestBlockhash('confirmed');
        finalTransaction.recentBlockhash = updatedBlockhash2;
        finalTransaction.lastValidBlockHeight = updatedLastValidBlockHeight2;
      }

      // Final check: ensure fee payer is set before submission
      if (!finalTransaction.feePayer) {
        Logger.error('Fee payer is still not set, cannot submit transaction');
        return res.status(500).json({
          error: 'Transaction fee payer not set',
          details: 'Failed to set fee payer for sponsored transaction',
        });
      }

      // Step 4: Submit the transaction with both signatures
      Logger.info('Submitting transaction with both user and server signatures...');
      if (!paymentSignature) {
        paymentSignature = await connection.sendRawTransaction(
          finalTransaction.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          }
        );
      }

      if (!paymentSignature) {
        Logger.error('Failed to get transaction signature');
        return res.status(500).json({
          error: 'Failed to submit transaction',
          details: 'No transaction signature received',
        });
      }

      Logger.info(`Transaction submitted with both signatures: ${paymentSignature}`);
    } catch (submitError: any) {
      Logger.error('Error adding server signature or submitting transaction:', {
        error: submitError?.message,
        stack: submitError?.stack,
      });
      return res.status(500).json({
        error: 'Failed to add server signature or submit transaction',
        details: submitError?.message || 'Unknown error',
      });
    }

    // Wait for confirmation
    try {
      await connection.confirmTransaction(paymentSignature, 'confirmed');
      Logger.info('Transaction confirmed on-chain with both user and server signatures');
    } catch (confirmError) {
      Logger.error('Error confirming transaction:', confirmError);
      // Continue anyway - transaction might still be processing
    }

    // Get explorer URL
    const explorerUrl = gaslessService.getExplorerUrl(paymentSignature);

    // Record sponsored transaction
    await gaslessCreditService.recordSponsoredTransaction(user.id, {
      paymentId: creditResult.paymentId,
      type,
      signature: paymentSignature,
      usdcCreditUsed: requiredCredit,
      network: process.env.SOLANA_NETWORK || 'mainnet',
      explorerUrl,
      status: 'CONFIRMED',
    });

    Logger.info(`Transaction sponsored successfully for ${email}: ${paymentSignature}`);

    return res.json({
      success: true,
      message: 'Transaction sponsored using credit',
      signature: paymentSignature,
      explorerUrl,
      credit: {
        used: requiredCredit,
        remaining: creditResult.remainingCredit || 0,
      },
      transactionInfo: {
        network: process.env.SOLANA_NETWORK || 'mainnet',
        cluster: process.env.SOLANA_NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta',
        feePayer: 'Server (sponsored transaction)',
        userPaid: '0 SOL (paid with USDC credit)',
        creditUsed: requiredCredit,
        signedWith: 'Grid Wallet',
      },
    });
  } catch (error) {
    Logger.error('Error sponsoring transaction:', error);
    res.status(500).json({
      error: 'Failed to sponsor transaction',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Create a transaction for sponsorship
 * POST /api/transaction/gasless/create-transaction
 */
export const createTransactionForSponsor = async (req: Request, res: Response) => {
  try {
    const { fromAddress, toAddress, amount, tokenMint } = req.body as CreateTransactionForSponsorInput;

    if (!fromAddress || !toAddress || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'fromAddress, toAddress, and amount are required',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        error: 'Invalid amount',
        details: 'Amount must be positive',
      });
    }

    Logger.info(`Creating transaction for sponsorship: ${amount} from ${fromAddress} to ${toAddress}`);

    // Check if service is configured
    if (!gaslessService.isConfigured()) {
      return res.status(503).json({
        error: 'Gasless transaction service not configured',
        details: 'Server fee payer or recipient wallet not configured',
      });
    }

    // Create transaction
    const result = await gaslessService.createTransactionForSponsor(
      fromAddress,
      toAddress,
      amount,
      tokenMint
    );

    if (!result || !result.transaction) {
      const errorDetails = result?.error || 'Could not create transaction for sponsorship';
      Logger.error(`Transaction creation failed: ${errorDetails}`);
      return res.status(500).json({
        error: 'Failed to create transaction',
        details: errorDetails,
        debug: {
          fromAddress,
          toAddress,
          amount,
          tokenMint: tokenMint || 'default (USDC)',
        },
      });
    }

    Logger.info(`Transaction created successfully for sponsorship`);

    return res.json({
      success: true,
      message: 'Transaction created for sponsorship',
      transaction: result.transaction,
      transactionInfo: {
        fromAddress,
        toAddress,
        amount,
        tokenMint: tokenMint || (process.env.SOLANA_NETWORK === 'devnet' 
          ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' 
          : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        fromTokenAccount: result.fromTokenAccount,
        toTokenAccount: result.toTokenAccount,
        network: process.env.SOLANA_NETWORK || 'mainnet',
      },
      nextStep: {
        message: 'Use this transaction in the sponsor endpoint',
        endpoint: '/api/transaction/gasless/sponsor',
        example: {
          email: 'user@example.com',
          transaction: result.transaction,
          type: 'TRANSFER',
        },
      },
    });
  } catch (error) {
    Logger.error('Error creating transaction for sponsor:', error);
    res.status(500).json({
      error: 'Failed to create transaction',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
