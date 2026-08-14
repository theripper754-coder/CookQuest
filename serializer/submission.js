const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema(
  {
    // อ้างอิงกลับไปหา request (เมนูนั้น)
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Request',
      required: true
    },
    createdBy: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },

    // ข้อมูลที่ submit และแก้ไขได้
    imageURL: {
      type: String,
      default: ''
    },
    tasteRating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    tasteTags: {
      type: [String],
      default: []
    },
    review: {
      type: String,
      default: ''
    },

    // track การแก้ไข
    editedAt: {
      type: Date
    },
    submittedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    collection: 'submissions'
  }
);

submissionSchema.index({ createdBy: 1, submittedAt: -1 });
submissionSchema.index({ requestId: 1 });

module.exports = mongoose.model('Submission', submissionSchema);