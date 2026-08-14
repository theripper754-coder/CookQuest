const mongoose = require('mongoose');

const questSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  exp: {
    type: Number,
    required: true
  },
  tags: [{
    type: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Quest', questSchema);