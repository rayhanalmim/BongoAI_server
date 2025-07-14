const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// Middleware to authenticate JWT token
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                error: 'Access denied',
                message: 'No token provided'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user || !user.isActive) {
            return res.status(404).json({
                error: 'User not found',
                message: 'User account not found or inactive'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(403).json({
                error: 'Invalid token',
                message: 'Token is invalid or expired'
            });
        }

        console.error('❌ Authentication error:', error);
        res.status(500).json({
            error: 'Authentication failed',
            message: 'Internal server error during authentication'
        });
    }
};

// Helper function to emit real-time updates
function emitUserUpdate(req, userId, updateData) {
    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');

    if (connectedUsers.has(userId)) {
        const socketId = connectedUsers.get(userId);
        io.to(socketId).emit('userUpdate', updateData);
    }
}

// GET /api/user/profile
// Get user profile information
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

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
            isActive: user.isActive,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            apiCallHistory: user.apiCallHistory.slice(-10) // Last 10 calls
        };

        res.json({
            success: true,
            user: userData
        });

    } catch (error) {
        console.error('❌ Get profile error:', error);
        res.status(500).json({
            error: 'Failed to get profile',
            message: 'Internal server error'
        });
    }
});

// GET /api/user/tokens
// Get current token balance
router.get('/tokens', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        res.json({
            success: true,
            tokens: user.tokens,
            totalApiCalls: user.totalApiCalls
        });

    } catch (error) {
        console.error('❌ Get tokens error:', error);
        res.status(500).json({
            error: 'Failed to get tokens',
            message: 'Internal server error'
        });
    }
});

// POST /api/user/consume-tokens
// Consume tokens for API call
router.post('/consume-tokens', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { category, model, endpoint } = req.body;

        if (!category || !model) {
            return res.status(400).json({
                error: 'Missing parameters',
                message: 'Category and model are required'
            });
        }

        // Calculate token cost
        const tokenCost = User.getTokenCost(category, model);

        // Check if user has enough tokens
        if (!user.hasEnoughTokens(tokenCost)) {
            return res.status(402).json({
                error: 'Insufficient tokens',
                message: `You need ${tokenCost} tokens but only have ${user.tokens}`,
                required: tokenCost,
                available: user.tokens
            });
        }

        // Deduct tokens
        const success = user.deductTokens(tokenCost);
        if (!success) {
            return res.status(402).json({
                error: 'Token deduction failed',
                message: 'Unable to deduct tokens'
            });
        }

        // Add API call to history
        user.addApiCall(endpoint || '/api/chat', model, tokenCost, category);

        // Save user
        await user.save();

        console.log(`💳 Tokens consumed: ${tokenCost} by ${user.email} for ${category}/${model}`);

        // Emit real-time update
        emitUserUpdate(req, user._id.toString(), {
            type: 'tokensConsumed',
            tokens: user.tokens,
            totalApiCalls: user.totalApiCalls,
            lastCall: {
                category,
                model,
                tokensUsed: tokenCost,
                timestamp: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Tokens consumed successfully',
            tokensUsed: tokenCost,
            remainingTokens: user.tokens,
            totalApiCalls: user.totalApiCalls
        });

    } catch (error) {
        console.error('❌ Consume tokens error:', error);
        res.status(500).json({
            error: 'Failed to consume tokens',
            message: 'Internal server error'
        });
    }
});

// POST /api/user/check-tokens
// Check if user has enough tokens for a specific operation
router.post('/check-tokens', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { category, model } = req.body;

        if (!category || !model) {
            return res.status(400).json({
                error: 'Missing parameters',
                message: 'Category and model are required'
            });
        }

        // Calculate token cost
        const tokenCost = User.getTokenCost(category, model);
        const hasEnough = user.hasEnoughTokens(tokenCost);

        res.json({
            success: true,
            hasEnoughTokens: hasEnough,
            required: tokenCost,
            available: user.tokens,
            category,
            model
        });

    } catch (error) {
        console.error('❌ Check tokens error:', error);
        res.status(500).json({
            error: 'Failed to check tokens',
            message: 'Internal server error'
        });
    }
});

// GET /api/user/api-history
// Get API call history
router.get('/api-history', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { limit = 50 } = req.query;

        const history = user.apiCallHistory
            .slice(-parseInt(limit))
            .reverse(); // Most recent first

        res.json({
            success: true,
            history,
            totalCalls: user.totalApiCalls
        });

    } catch (error) {
        console.error('❌ Get API history error:', error);
        res.status(500).json({
            error: 'Failed to get API history',
            message: 'Internal server error'
        });
    }
});

// GET /api/user/stats
// Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        // Calculate stats from API call history
        const totalCalls = user.totalApiCalls;
        const totalTokensUsed = user.apiCallHistory.reduce((sum, call) => sum + call.tokensUsed, 0);

        // Category breakdown
        const categoryStats = user.apiCallHistory.reduce((stats, call) => {
            if (!stats[call.category]) {
                stats[call.category] = { calls: 0, tokens: 0 };
            }
            stats[call.category].calls += 1;
            stats[call.category].tokens += call.tokensUsed;
            return stats;
        }, {});

        // Recent activity (last 7 days)
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentCalls = user.apiCallHistory.filter(call =>
            new Date(call.timestamp) > weekAgo
        ).length;

        res.json({
            success: true,
            stats: {
                currentTokens: user.tokens,
                totalApiCalls: totalCalls,
                totalTokensUsed,
                hasReceivedSignupBonus: user.hasReceivedSignupBonus,
                memberSince: user.createdAt,
                lastLogin: user.lastLogin,
                recentCalls,
                categoryBreakdown: categoryStats
            }
        });

    } catch (error) {
        console.error('❌ Get stats error:', error);
        res.status(500).json({
            error: 'Failed to get stats',
            message: 'Internal server error'
        });
    }
});

// POST /api/user/add-tokens (Admin function - for future use)
router.post('/add-tokens', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const { amount, reason } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                error: 'Invalid amount',
                message: 'Amount must be a positive number'
            });
        }

        // For now, anyone can add tokens (you might want to restrict this to admins)
        const newBalance = user.addTokens(amount);
        await user.save();

        console.log(`💰 Tokens added: ${amount} to ${user.email}. Reason: ${reason || 'Manual add'}`);

        // Emit real-time update
        emitUserUpdate(req, user._id.toString(), {
            type: 'tokensAdded',
            tokens: user.tokens,
            tokensAdded: amount,
            reason: reason || 'Manual add'
        });

        res.json({
            success: true,
            message: 'Tokens added successfully',
            tokensAdded: amount,
            newBalance,
            reason: reason || 'Manual add'
        });

    } catch (error) {
        console.error('❌ Add tokens error:', error);
        res.status(500).json({
            error: 'Failed to add tokens',
            message: 'Internal server error'
        });
    }
});

// GET /api/user/token-costs
// Get token costs for different operations
router.get('/token-costs', (req, res) => {
    try {
        const costs = {
            text: {
                'claude-opus-4': 1,
                'claude-sonnet-4': 1,
                'claude-3-7-sonnet': 1
            },
            image: {
                'nova-canvas': 2
            },
            video: {
                'nova-reel': 3
            }
        };

        res.json({
            success: true,
            tokenCosts: costs,
            freeTokensForNewUsers: parseInt(process.env.FREE_TOKENS_NEW_USER) || 10
        });

    } catch (error) {
        console.error('❌ Get token costs error:', error);
        res.status(500).json({
            error: 'Failed to get token costs',
            message: 'Internal server error'
        });
    }
});

module.exports = router; 