const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    userId:    { type: String, required: true },  // คนที่กด favorite
    menuId: {                                     // เมนูที่ถูก favorite
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Menu',
      required: true
    },
  },
  {
    timestamps: true,   // createdAt = วันที่กด favorite
    collection: 'favorites'
  }
);

// ป้องกัน user กด favorite เมนูเดิมซ้ำ
favoriteSchema.index({ userId: 1, menuId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1 });

module.exports = mongoose.model('Favorite', favoriteSchema);