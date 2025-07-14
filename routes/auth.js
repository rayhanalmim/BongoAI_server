const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// Helper function to decode Google JWT token
function decodeGoogleToken(token) {
    try {
        // Decode the JWT token payload (Google's credential)
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        return payload;
    } catch (error) {
        console.error('Error decoding Google token:', error);
        return null;
    }
}

// Helper function to generate our JWT token
function generateJWTToken(user) {
    return jwt.sign(
        {
            userId: user._id,
            email: user.email,
            googleId: user.googleId
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// Helper function to emit real-time updates
function emitUserUpdate(req, userId, updateData) {
    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');

    if (connectedUsers.has(userId)) {
        const socketId = connectedUsers.get(userId);
        io.to(socketId).emit('userUpdate', updateData);
    }
}

// POST /api/auth/google-login
// Handle Google OAuth login
router.post('/google-login', async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({
                error: 'Missing credential',
                message: 'Google credential is required'
            });
        }

        // Decode Google token
        const googlePayload = decodeGoogleToken(credential);
        if (!googlePayload) {
            return res.status(400).json({
                error: 'Invalid credential',
                message: 'Failed to decode Google credential'
            });
        }

        const { sub: googleId, email, name, given_name, family_name, picture } = googlePayload;

        // Check if user exists
        let user = await User.findOne({ $or: [{ googleId }, { email }] });

        if (user) {
            // Existing user - update login time and info
            user.lastLogin = new Date();
            user.name = name;
            user.given_name = given_name;
            user.family_name = family_name;
            user.picture = picture;

            // Update googleId if it was missing
            if (!user.googleId) {
                user.googleId = googleId;
            }

            await user.save();

            console.log(`👋 Existing user logged in: ${email}`);
        } else {
            // New user - create account and give signup bonus
            const freeTokens = parseInt(process.env.FREE_TOKENS_NEW_USER) || 10;

            user = new User({
                googleId,
                email,
                name,
                given_name,
                family_name,
                picture,
                tokens: freeTokens,
                hasReceivedSignupBonus: true,
                lastLogin: new Date()
            });

            await user.save();

            console.log(`🎉 New user created: ${email} with ${freeTokens} free tokens`);
        }

        // Generate our JWT token
        const token = generateJWTToken(user);

        // Prepare user data for response (remove sensitive info)
        const userData = {
            id: user._id,
            googleId: user.googleId,
            email: user.email,
            name: user.name,
            given_name: user.given_name,
            family_name: user.family_name,
            picture: user.picture,
            tokens: user.tokens,
            totalApiCalls: user.totalApiCalls,
            hasReceivedSignupBonus: user.hasReceivedSignupBonus,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        };

        res.json({
            success: true,
            message: user.hasReceivedSignupBonus ? 'Login successful' : 'Welcome! You received free tokens',
            token,
            user: userData
        });

        // Emit real-time update
        emitUserUpdate(req, user._id.toString(), {
            type: 'login',
            tokens: user.tokens,
            totalApiCalls: user.totalApiCalls
        });

    } catch (error) {
        console.error('❌ Google login error:', error);
        res.status(500).json({
            error: 'Login failed',
            message: 'Internal server error during login'
        });
    }
});

// POST /api/auth/verify-token
// Verify JWT token and return user data
router.post('/verify-token', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                error: 'Missing token',
                message: 'JWT token is required'
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from database
        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            return res.status(404).json({
                error: 'User not found',
                message: 'User account not found or inactive'
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Prepare user data for response
        const userData = {
            id: user._id,
            googleId: user.googleId,
            email: user.email,
            name: user.name,
            given_name: user.given_name,
            family_name: user.family_name,
            picture: user.picture,
            tokens: user.tokens,
            totalApiCalls: user.totalApiCalls,
            hasReceivedSignupBonus: user.hasReceivedSignupBonus,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        };

        res.json({
            success: true,
            valid: true,
            user: userData
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'JWT token is invalid',
                valid: false
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'JWT token has expired',
                valid: false
            });
        }

        console.error('❌ Token verification error:', error);
        res.status(500).json({
            error: 'Verification failed',
            message: 'Internal server error during token verification',
            valid: false
        });
    }
});

// POST /api/auth/logout
// Handle user logout (mainly for logging purposes)
router.post('/logout', async (req, res) => {
    try {
        const { userId } = req.body;

        if (userId) {
            console.log(`👋 User logged out: ${userId}`);

            // Emit logout event
            emitUserUpdate(req, userId, { type: 'logout' });
        }

        res.json({
            success: true,
            message: 'Logout successful'
        });

    } catch (error) {
        console.error('❌ Logout error:', error);
        res.status(500).json({
            error: 'Logout failed',
            message: 'Internal server error during logout'
        });
    }
});

module.exports = router; 