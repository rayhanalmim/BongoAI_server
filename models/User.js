const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // Google OAuth data
    googleId: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    given_name: {
        type: String,
        required: true
    },
    family_name: {
        type: String
    },
    picture: {
        type: String
    },

    // Token Management
    tokens: {
        type: Number,
        default: 0,
        min: 0
    },

    // API Usage Tracking
    totalApiCalls: {
        type: Number,
        default: 0
    },

    // API Call History (last 100 calls)
    apiCallHistory: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        endpoint: String,
        model: String,
        tokensUsed: Number,
        category: {
            type: String,
            enum: ['text', 'image', 'video']
        }
    }],

    // User status
    isActive: {
        type: Boolean,
        default: true
    },

    // Signup bonus tracking
    hasReceivedSignupBonus: {
        type: Boolean,
        default: false
    },

    // Last login tracking
    lastLogin: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true // adds createdAt and updatedAt
});

// Index for better performance
userSchema.index({ googleId: 1 });
userSchema.index({ email: 1 });

// Instance method to deduct tokens
userSchema.methods.deductTokens = function (amount) {
    if (this.tokens >= amount) {
        this.tokens -= amount;
        this.totalApiCalls += 1;
        return true;
    }
    return false;
};

// Instance method to add tokens
userSchema.methods.addTokens = function (amount) {
    this.tokens += amount;
    return this.tokens;
};

// Instance method to check if user has enough tokens
userSchema.methods.hasEnoughTokens = function (amount) {
    return this.tokens >= amount;
};

// Instance method to add API call to history
userSchema.methods.addApiCall = function (endpoint, model, tokensUsed, category) {
    this.apiCallHistory.push({
        endpoint,
        model,
        tokensUsed,
        category,
        timestamp: new Date()
    });

    // Keep only last 100 API calls
    if (this.apiCallHistory.length > 100) {
        this.apiCallHistory = this.apiCallHistory.slice(-100);
    }
};

// Static method to calculate token cost for different operations
userSchema.statics.getTokenCost = function (category, model) {
    const tokenCosts = {
        text: {
            'claude-opus-4': 1,
            'claude-sonnet-4': 1,
            'claude-3-7-sonnet': 1,
            default: 1
        },
        image: {
            'nova-canvas': 2,
            default: 2
        },
        video: {
            'nova-reel': 3,
            default: 3
        }
    };

    return tokenCosts[category]?.[model] || tokenCosts[category]?.default || 1;
};

module.exports = mongoose.model('User', userSchema); 