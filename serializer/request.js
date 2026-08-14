const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    menuName: {
      type: String,
      default: ''
    },
    createdBy: {
      type: String,
      default: ''
    },
    randomQuests: {
      type: String,
      default: ''
    },
    imageURL: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    submittedAt: {
      type: Date
    },
    // Taste : ★★★☆☆  (1–5)
    tasteRating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },

    // tag รสชาติที่กด: ["หวาน","เค็ม","อูมามิ"]
    tasteTags: {
      type: [String],
      default: []
    },

    // textarea "รสชาติอาหารของคุณเป็นอย่างไรบ้าง"
    review: {
      type: String,
      default: ''
    },
  },
  {
    timestamps: true,
    strict: false,
    collection: 'requests'
  }
);

requestSchema.index({ createdAt: -1 });
requestSchema.index({ status: 1, createdAt: -1 });
requestSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Request', requestSchema);
