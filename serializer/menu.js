const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  menuName: {
    type: String,
    required: true
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
  EXP: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: String,
    default: ''
  },
  imageURL: {
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
  tags: [{
    type: String
  }],
  questIds: [{
    type: String
  }],
}, {
  timestamps: true
});

// Fields for list/card views — excludes heavy instructions (base64 step images) and ingredients
menuSchema.statics.LIST_PROJECTION = {
  menuName: 1,
  EXP: 1,
  tags: 1,
  servings: 1,
  prepTime: 1,
  cookTime: 1,
  questIds: 1,
  createdBy: 1,
  createdAt: 1,
  updatedAt: 1
};

menuSchema.statics.LIST_AGGREGATION = [
  {
    $project: {
      menuName: 1,
      EXP: 1,
      tags: 1,
      servings: 1,
      prepTime: 1,
      cookTime: 1,
      questIds: 1,
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
      hasImage: {
        $regexMatch: {
          input: { $ifNull: ['$imageURL', ''] },
          regex: /^data:/
        }
      },
      imageURL: {
        $cond: {
          if: {
            $regexMatch: {
              input: { $ifNull: ['$imageURL', ''] },
              regex: /^data:/
            }
          },
          then: '',
          else: { $ifNull: ['$imageURL', ''] }
        }
      }
    }
  }
];

module.exports = mongoose.model('Menu', menuSchema);