const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },

  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },

  password: {
    type: String,
    required: true,
  },

    otp: String,
    otpRef: String,
    otpExpire: Date,
    resetPasswordOtp: String,
    resetPasswordOtpRef: String,
    resetPasswordOtpExpire: Date,
    isVerified: {
    type: Boolean,
    default: false
    },

    role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },

  level: {
        type: Number,
        default: 1
    },

    rank: {
        type: String,
        default: 'BRONZE Chef'
    },

    exp: {
        type: Number,
        default: 0
    },

    completedRecipes: {
        type: Number,
        default: 0
    },

    badges: [{
        name: String,
        icon: String,
        earnedAt: { type: Date, default: Date.now }
    }],

    completedQuests: [{
        type: String
    }]
}, {
  timestamps: true
});



module.exports = mongoose.model('User', userSchema);
