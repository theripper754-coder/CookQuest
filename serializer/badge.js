const mongoose = require('mongoose');

const badgeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  icon: {
    type: String,
    required: true,
    trim: true,
  },
  desc: {
    type: String,
    required: true,
    trim: true,
  },
  ruleType: {
    type: String,
    enum: ['level', 'recipes_count', 'cooking_streak', 'star_rating', 'healthy_meals', 'category_count', 'manual'],
    default: 'manual'
  },
  ruleValue: {
    type: Number,
    default: 0
  },
  ruleCategory: {
    type: String,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'badges'
});

module.exports = mongoose.model('Badge', badgeSchema);
