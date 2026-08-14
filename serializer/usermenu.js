const mongoose = require('mongoose');

const userMenuSchema = new mongoose.Schema({
  menuName: {
    type: String,
    required: true
  },
  imageURL: {
    type: String,
    default: ''
  },
  servings: {
    type: Number,
    default: 1
  },
  prepTime: {
    type: String,
    default: ''
  },
  cookTime: {
    type: String,
    default: ''
  },
  createdBy: {
    type: String,
    default: ''
  },
  ingredients: [{
    name: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    unit: {
      type: String,
      required: true
    }
  }],
  instructions: [{
    stepNumber: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    stepImageURL: {
      type: String,
      default: ''
    }
  }],

  tasteRating: {
    type: Number,
    default: 0
  },
  tasteTags: [{
    type: String
  }],
  review: {
    type: String,
    default: ''
  }
}, 
{   
  timestamps: true,
  collection: 'userMenu'
}
);

module.exports = mongoose.model('userMenu', userMenuSchema);