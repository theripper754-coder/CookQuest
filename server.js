require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const dns = require("dns");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const nodemailer = require('nodemailer');
const setupSwagger = require('./swagger');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer memory storage initialization
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});


// ผมไม่สามารถเข้าปกติได้ ต้องset dns ไว้
dns.setServers([
  "8.8.8.8",
  "8.8.4.4",
]);

const app = express();
const PORT = process.env.PORT;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Prevent API caching middleware
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static('.'));

// Setup Swagger Documentation
setupSwagger(app, PORT);

// Import models at the top
const Menu = require('./serializer/menu');
const Quest = require('./serializer/quest');
const Request = require('./serializer/request');
const Submission = require('./serializer/submission');
const Favorite = require('./serializer/favorite');
const UserMenu = require('./serializer/usermenu');
const User = require('./serializer/user');
const Badge = require('./serializer/badge');

async function seedBadges() {
  try {
    const defaultBadges = [
      {
        name: 'First Blood',
        icon: '🔪',
        desc: 'Complete your first cooking quest',
        ruleType: 'recipes_count',
        ruleValue: 1
      },
      {
        name: 'Master Chef',
        icon: '👨‍🍳',
        desc: 'Reach Level 5 (Platinum Chef)',
        ruleType: 'level',
        ruleValue: 5
      },
      {
        name: 'Star Baker',
        icon: '⭐',
        desc: 'Get a 5-star taste rating on a quest',
        ruleType: 'star_rating',
        ruleValue: 5
      },
      {
        name: 'Fire Starter',
        icon: '🔥',
        desc: 'Maintain a 3-day cooking streak',
        ruleType: 'cooking_streak',
        ruleValue: 3
      },
      {
        name: 'Healthy Eats',
        icon: '🥗',
        desc: 'Cook 5 healthy meals (Salad/Veg)',
        ruleType: 'healthy_meals',
        ruleValue: 5
      },
      {
        name: 'First Dish',
        icon: '👨‍🍳',
        desc: 'Complete 1 dish milestone',
        ruleType: 'recipes_count',
        ruleValue: 1
      },
      {
        name: '5 Dishes',
        icon: '🔥',
        desc: 'Complete 5 dishes milestone',
        ruleType: 'recipes_count',
        ruleValue: 5
      },
      {
        name: '10 Dishes',
        icon: '👑',
        desc: 'Complete 10 dishes milestone',
        ruleType: 'recipes_count',
        ruleValue: 10
      }
    ];

    for (const defBadge of defaultBadges) {
      const existing = await Badge.findOne({ name: defBadge.name });
      if (existing) {
        if (!existing.ruleType || existing.ruleType === 'manual' || existing.ruleValue !== defBadge.ruleValue) {
          existing.ruleType = defBadge.ruleType;
          existing.ruleValue = defBadge.ruleValue;
          existing.desc = defBadge.desc;
          existing.icon = defBadge.icon;
          await existing.save();
          console.log(`✓ Updated badge rules for: ${defBadge.name}`);
        }
      } else {
        await Badge.create(defBadge);
        console.log(`✓ Seeded new badge: ${defBadge.name}`);
      }
    }
    console.log('✓ Seeding check completed');
  } catch (err) {
    console.error('✗ Error seeding badges:', err);
  }
}

async function checkAndAwardBadges(user) {
  try {
    if (!user) return;
    const approvedDishes = await Request.find({
      $or: [
        { createdBy: user._id.toString() },
        { createdBy: user.username }
      ],
      status: 'approved'
    }).lean();
    const badges = await Badge.find().lean();
    let userUpdated = false;

    // Sync completedRecipes count in database to match the unique approved recipes count
    const uniqueApprovedMenus = new Set(
      approvedDishes
        .filter(d => d.menuName)
        .map(d => d.menuName.toLowerCase().trim())
    );
    const uniqueCount = uniqueApprovedMenus.size;
    if (user.completedRecipes !== uniqueCount) {
      user.completedRecipes = uniqueCount;
      userUpdated = true;
    }

    if (!user.badges) {
      user.badges = [];
    }
    const earnedBadgeNames = user.badges.map(b => b.name);

    // Cache menus for healthy meals check
    let allMenus = null;

    for (const badge of badges) {
      if (earnedBadgeNames.includes(badge.name)) {
        continue;
      }

      let isUnlocked = false;

      switch (badge.ruleType) {
        case 'level':
          if (user.level >= (badge.ruleValue || 0)) {
            isUnlocked = true;
          }
          break;
        case 'recipes_count':
          const count = Math.max(user.completedRecipes || 0, approvedDishes.length);
          if (count >= (badge.ruleValue || 0)) {
            isUnlocked = true;
          }
          break;
        case 'cooking_streak': {
          const uniqueDays = [...new Set(approvedDishes.map(d => {
            const dateVal = d.submittedAt || d.createdAt;
            return new Date(dateVal).setHours(0, 0, 0, 0);
          }))].sort((a, b) => a - b);

          let maxStreak = 0;
          let currentStreak = 0;
          let lastDate = null;
          for (const day of uniqueDays) {
            if (lastDate && day - lastDate === 86400000) {
              currentStreak++;
            } else {
              currentStreak = 1;
            }
            maxStreak = Math.max(maxStreak, currentStreak);
            lastDate = day;
          }

          if (maxStreak >= (badge.ruleValue || 0)) {
            isUnlocked = true;
          }
          break;
        }
        case 'star_rating': {
          const targetStar = badge.ruleValue || 5;
          const hasStar = approvedDishes.some(d => d.tasteRating >= targetStar);
          if (hasStar) {
            isUnlocked = true;
          }
          break;
        }
        case 'healthy_meals': {
          if (!allMenus) {
            allMenus = await Menu.find().lean();
          }
          const targetCount = badge.ruleValue || 0;
          const healthyCount = approvedDishes.filter(d => {
            const menuName = d.menuName || '';
            const menu = allMenus.find(m => (m.menuName || '').toLowerCase() === menuName.toLowerCase());
            const tags = menu?.tags || [];
            return tags.some(t => typeof t === 'string' && (t.includes('สลัด') || t.includes('ผัก') || t.includes('คลีน')));
          }).length;

          if (healthyCount >= targetCount) {
            isUnlocked = true;
          }
          break;
        }
        case 'category_count': {
          if (!allMenus) {
            allMenus = await Menu.find().lean();
          }
          const targetCategory = (badge.ruleCategory || '').toLowerCase().trim();
          const targetCount = badge.ruleValue || 0;

          if (!targetCategory) break;

          const matchingCount = approvedDishes.filter(d => {
            const menuName = d.menuName || '';
            const menu = allMenus.find(m => (m.menuName || '').toLowerCase() === menuName.toLowerCase());
            const tags = menu?.tags || [];
            return tags.some(t => typeof t === 'string' && t.toLowerCase().includes(targetCategory));
          }).length;

          if (matchingCount >= targetCount) {
            isUnlocked = true;
          }
          break;
        }
        case 'manual':
        default:
          break;
      }

      if (isUnlocked) {
        user.badges.push({
          name: badge.name,
          icon: badge.icon,
          earnedAt: new Date()
        });
        userUpdated = true;
      }
    }

    if (userUpdated) {
      await user.save();
    }
  } catch (err) {
    console.error('Error in checkAndAwardBadges:', err);
  }
}


const PRESET_CATEGORIES = [
  // วัตถุดิบ
  "เมนูไข่", "เมนูไก่", "เมนูหมู", "เมนูเป็ด", "เมนูเนื้อวัว", "เมนูไส้กรอก", "เมนูเบคอน", "เมนูอาหารทะเล", "เมนูเส้น", "เมนูเห็ด", "เมนูเต้าหู้", "เมนูข้าว", "เมนูผัก", "เมนูผลไม้",
  // ประเภทอาหาร
  "เมนูอาหารเช้า", "เมนูอาหารจานเดียว", "เมนูกับแกล้ม/อาหารว่าง", "เมนูมังสวิรัติ", "เมนูอาหารไทย", "เมนูอาหารเหนือ", "เมนูอาหารอีสาน", "เมนูอาหารใต้", "เมนูอาหารญี่ปุ่น", "เมนูอาหารจีน", "เมนูอาหารเกาหลี", "เมนูอาหารฝรั่ง", "เมนูอาหารอิตาเลียน", "เมนูสเต๊ก", "เมนูแกง", "สูตรน้ำจิ้ม", "เมนูอาหารฟิวชัน", "เมนูซุป", "อาหารนานาชาติ", "เมนูแซนด์วิช", "เมนูอาหารเย็น", "เมนูน้ำพริก", "เมนูกับข้าว", "เมนูก๋วยเตี๋ยว",
  // วิธีการ
  "เมนูไมโครเวฟ", "เมนูต้ม", "เมนูผัด", "เมนูทอด", "เมนูอบ", "เมนูนึ่ง", "เมนูยำ", "เมนูย่าง", "เมนูหม้ออบลมร้อน", "เมนูหม้อหุงข้าว",
  // ของหวาน/เบเกอรี่
  "เมนูไอศกรีม", "เมนูขนมไทย", "เมนูเบเกอรี", "เมนูเค้ก", "เมนูของหวาน", "เมนูช็อคโกแลต",
  // เมนูพิเศษ
  "เมนูทำง่ายไม่เกิน 15 นาที", "เมนูประหยัด", "เมนูเด็กหอ", "เมนูสร้างอาชีพ", "เมนูข้าวกล่อง", "เมนูวาเลนไทน์", "เมนูฮาโลวีน", "เมนูคริสต์มาส",
  // อาหารเพื่อสุขภาพ
  "สูตรน้ำสลัด", "เมนูอาหารคลีน", "เมนูสลัด", "เมนูอาหารลดน้ำหนัก", "เมนูอาหารแคลอรี่ต่ำ", "เมนูอาหารไขมันต่ำ", "เมนูอาหารไฟเบอร์สูง"
];

function isBase64DataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

// Helper to normalize nested multipart form data (strings starting with [ or { into objects)
const normalizeMultipartBody = (body) => {
  const normalized = { ...body };
  for (const key in normalized) {
    if (typeof normalized[key] === 'string') {
      const trimmed = normalized[key].trim();
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          normalized[key] = JSON.parse(trimmed);
        } catch (e) {
          // Ignore parse errors, keep as string
        }
      }
    }
  }
  return normalized;
};

// Helper to upload a buffer to Cloudinary
const uploadBufferToCloudinary = (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(fileBuffer);
  });
};

// Helper to upload a base64 string to Cloudinary
const uploadBase64ToCloudinary = async (base64Str, folder) => {
  if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:')) {
    return base64Str; // Return as-is if not base64
  }
  try {
    const result = await cloudinary.uploader.upload(base64Str, { folder });
    return result.secure_url;
  } catch (error) {
    console.error('Error uploading base64 to Cloudinary:', error.message);
    throw error;
  }
};

// Helper to process menu and userMenu image uploads
const processMenuImages = async (req, folder) => {
  const body = normalizeMultipartBody(req.body);

  // 1. Process files from Multer
  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      if (file.fieldname === 'image' || file.fieldname === 'imageURL') {
        body.imageURL = await uploadBufferToCloudinary(file.buffer, folder);
      } else if (file.fieldname.startsWith('stepImage_')) {
        const parts = file.fieldname.split('_');
        const stepNum = parseInt(parts[1], 10);
        const secureUrl = await uploadBufferToCloudinary(file.buffer, folder);

        if (body.instructions && Array.isArray(body.instructions)) {
          let stepObj = body.instructions.find(inst => inst.stepNumber === stepNum);
          if (!stepObj) {
            // Fallback: match by index
            stepObj = body.instructions[stepNum];
          }
          if (stepObj) {
            stepObj.stepImageURL = secureUrl;
          }
        }
      }
    }
  }

  // 2. Process base64 strings in payload
  if (body.imageURL && isBase64DataUrl(body.imageURL)) {
    body.imageURL = await uploadBase64ToCloudinary(body.imageURL, folder);
  }
  if (body.instructions && Array.isArray(body.instructions)) {
    for (const inst of body.instructions) {
      if (inst.stepImageURL && isBase64DataUrl(inst.stepImageURL)) {
        inst.stepImageURL = await uploadBase64ToCloudinary(inst.stepImageURL, folder);
      }
    }
  }

  return body;
};

// Helper to process requests/submissions image uploads
const processSubmissionImages = async (req) => {
  const body = normalizeMultipartBody(req.body);
  let submissionImageUrl = body.imageURL || '';
  let requestImageUrl = body.imageURL || '';

  // 1. Process files from Multer
  if (req.files && req.files.length > 0) {
    const file = req.files.find(f => f.fieldname === 'image' || f.fieldname === 'imageURL');
    if (file) {
      submissionImageUrl = await uploadBufferToCloudinary(file.buffer, 'CookQuest/submissions');
      requestImageUrl = await uploadBufferToCloudinary(file.buffer, 'CookQuest/requests');
    }
  }

  // 2. Process base64 strings
  if (isBase64DataUrl(submissionImageUrl)) {
    submissionImageUrl = await uploadBase64ToCloudinary(submissionImageUrl, 'CookQuest/submissions');
    requestImageUrl = await uploadBase64ToCloudinary(body.imageURL, 'CookQuest/requests');
  }

  return {
    body,
    submissionImageUrl,
    requestImageUrl
  };
};


function toMenuListItem(menu) {
  if (!menu) return menu;
  if (isBase64DataUrl(menu.imageURL)) {
    return { ...menu, hasImage: true, imageURL: '' };
  }
  return menu;
}

function toRequestListItem(request) {
  if (!request) return request;
  if (isBase64DataUrl(request.imageURL)) {
    return { ...request, hasImage: true, imageURL: '' };
  }
  return request;
}
// MongoDB connection
const mongoURI = process.env.MONGODB_URI;

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
})
  .then(async () => {
    console.log('✓ MongoDB connected successfully');
    await Promise.all([
      Request.syncIndexes(),
      Submission.syncIndexes(),
      Favorite.syncIndexes(),
    ]);
    console.log('✓ Database indexes synced');

    await seedBadges();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Check server at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('✗ MongoDB connection error:', err.message);
    console.error('Connection string:', mongoURI);
    process.exit(1);
  });

// Handle connection events
mongoose.connection.on('disconnected', () => {
  console.log('⚠ MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('✗ MongoDB error:', err.message);
});

//OTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function generateOtpRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sendOtpEmailHtml({ to, subject, purpose, otp, refCode, expireMinutes }) {
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'Nunito', 'Segoe UI', Arial, sans-serif;
      background-color: #f7f9fc;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f7f9fc;
      padding: 40px 0;
    }
    .container {
      max-width: 550px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #ffa954, #ff8c2b);
      padding: 30px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    .content {
      padding: 40px 30px;
      color: #333333;
      line-height: 1.6;
    }
    .title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 20px;
      color: #222222;
      text-align: center;
    }
    .desc {
      font-size: 15px;
      color: #666666;
      text-align: center;
      margin-bottom: 30px;
    }
    .otp-box {
      background-color: #fff8f0;
      border: 2px dashed #ffa954;
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      margin: 25px 0;
    }
    .otp-code {
      font-size: 36px;
      font-weight: 800;
      color: #ff8c2b;
      letter-spacing: 8px;
      margin: 0;
      padding-left: 8px;
    }
    .ref-code {
      font-size: 14px;
      font-weight: 600;
      color: #888888;
      margin-top: 10px;
    }
    .ref-code span {
      background-color: #ffa954;
      color: #ffffff;
      padding: 3px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 15px;
      letter-spacing: 1px;
    }
    .info {
      font-size: 13px;
      color: #999999;
      text-align: center;
      margin-top: 20px;
    }
    .footer {
      background-color: #fafbfc;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #aaaaaa;
      border-top: 1px solid #eeeeee;
    }
    .footer a {
      color: #ffa954;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>🍳 CookQuest</h1>
      </div>
      <div class="content">
        <div class="title">${purpose}</div>
        <div class="desc">Please use the verification code below to complete your action.</div>
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
          <div class="ref-code">Reference Code: <span>${refCode}</span></div>
        </div>
        <div class="info">
          This verification code is valid for <strong>${expireMinutes} minutes</strong>.<br>
          If you did not request this code, please secure your account immediately.
        </div>
      </div>
      <div class="footer">
        © 2026 CookQuest. All rights reserved.<br>
        Let's cook your path to culinary glory!
      </div>
    </div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from: '"CookQuest" <' + process.env.EMAIL_USER + '>',
    to,
    subject,
    html: htmlContent
  });
}

// Routes
app.post('/api/register', async (req, res) => {

  try {

    const { username, email, password } = req.body;

    if (!username || username.trim().length > 10) {
      return res.status(400).json({
        msg: 'Username must not exceed 10 characters'
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        msg: 'Password must be at least 6 characters'
      });
    }

    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;
    if (!email || !gmailRegex.test(String(email).trim())) {
      return res.status(400).json({
        msg: 'Email must be a valid Gmail address (e.g. user@gmail.com)'
      });
    }

    // เช็ค user ซ้ำ (case-insensitive)
    const escapedUsername = String(username || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEmail = String(email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exist = await User.findOne({
      $or: [
        { username: { $regex: '^' + escapedUsername + '$', $options: 'i' } },
        { email: { $regex: '^' + escapedEmail + '$', $options: 'i' } }
      ]
    });

    if (exist) {
      return res.status(400).json({
        msg: 'User already exists'
      });
    }

    // HASH PASSWORD
    const hashedPassword = await bcrypt.hash(password, 10);

    // CREATE USER
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      level: 1,
      rank: 'BRONZE Chef',
      exp: 0
    });

    //OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpRef = generateOtpRef();

    user.otp = otp;
    user.otpRef = otpRef;
    user.otpExpire = Date.now() + 5 * 60 * 1000;

    await user.save();

    await sendOtpEmailHtml({
      to: user.email,
      subject: 'Welcome to CookQuest - Verify Your Account',
      purpose: 'Account Verification',
      otp,
      refCode: otpRef,
      expireMinutes: 5
    });

    res.json({
      msg: 'Register success',
      otpRef,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      msg: 'Server error'
    });

  }

});

app.post('/api/verify-otp', async (req, res) => {
  console.log("BODY:", req.body);

  const { email, otp } = req.body;
  const normalizedEmail = String(email || '').trim();
  const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const user = await User.findOne({
    email: { $regex: '^' + escapedEmail + '$', $options: 'i' }
  });
  console.log("email:", email);
  console.log("otp:", otp);

  if (!user) {
    return res.status(404).json({
      msg: 'User not found'
    });
  }

  if (user.otp !== otp) {
    return res.status(400).json({
      msg: 'OTP incorrect'
    });
  }

  if (user.otpExpire < Date.now()) {
    return res.status(400).json({
      msg: 'OTP expired'
    });
  }

  user.isVerified = true;

  user.otp = null;
  user.otpExpire = null;

  await user.save();

  res.json({
    msg: 'Verify success'
  });

});

app.post('/api/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) {
      return res.status(400).json({ msg: 'Email is required' });
    }
    const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const user = await User.findOne({
      email: { $regex: '^' + escapedEmail + '$', $options: 'i' }
    });

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    if (user.isVerified) {
      return res.status(400).json({ msg: 'User is already verified' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpRef = generateOtpRef();
    user.otp = otp;
    user.otpRef = otpRef;
    user.otpExpire = Date.now() + 5 * 60 * 1000;
    await user.save();

    await sendOtpEmailHtml({
      to: user.email,
      subject: 'Your New CookQuest OTP Code',
      purpose: 'Account Verification (Resend)',
      otp,
      refCode: otpRef,
      expireMinutes: 5
    });

    res.json({
      msg: 'OTP has been resent successfully',
      otpRef
    });
  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { identity } = req.body;
    const normalizedIdentity = String(identity || '').trim();

    if (!normalizedIdentity) {
      return res.status(400).json({ msg: 'Please provide username or email' });
    }

    const escapedIdentity = normalizedIdentity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await User.findOne({
      $or: [
        { email: { $regex: '^' + escapedIdentity + '$', $options: 'i' } },
        { username: { $regex: '^' + escapedIdentity + '$', $options: 'i' } }
      ]
    });

    // Do not expose whether account exists
    if (!user) {
      const dummyRef = generateOtpRef();
      return res.json({
        msg: 'If this account exists, we sent a reset OTP to the registered email.',
        otpRef: dummyRef
      });
    }

    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetPasswordOtpRef = generateOtpRef();
    user.resetPasswordOtp = resetOtp;
    user.resetPasswordOtpRef = resetPasswordOtpRef;
    user.resetPasswordOtpExpire = Date.now() + (10 * 60 * 1000);
    await user.save();

    await sendOtpEmailHtml({
      to: user.email,
      subject: 'CookQuest Password Reset OTP',
      purpose: 'Password Reset Verification',
      otp: resetOtp,
      refCode: resetPasswordOtpRef,
      expireMinutes: 10
    });

    return res.json({
      msg: 'If this account exists, we sent a reset OTP to the registered email.',
      otpRef: resetPasswordOtpRef
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { identity, otp, newPassword } = req.body;
    const normalizedIdentity = String(identity || '').trim();
    const normalizedOtp = String(otp || '').trim();
    const password = String(newPassword || '');

    if (!normalizedIdentity || !normalizedOtp || !password) {
      return res.status(400).json({ msg: 'Identity, OTP and new password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ msg: 'New password must be at least 6 characters' });
    }

    const escapedIdentity = normalizedIdentity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await User.findOne({
      $or: [
        { email: { $regex: '^' + escapedIdentity + '$', $options: 'i' } },
        { username: { $regex: '^' + escapedIdentity + '$', $options: 'i' } }
      ]
    });

    if (!user || !user.resetPasswordOtp || !user.resetPasswordOtpExpire) {
      return res.status(400).json({ msg: 'Invalid reset request' });
    }

    if (user.resetPasswordOtp !== normalizedOtp) {
      return res.status(400).json({ msg: 'Invalid OTP' });
    }

    if (user.resetPasswordOtpExpire < Date.now()) {
      return res.status(400).json({ msg: 'OTP expired' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordOtp = null;
    user.resetPasswordOtpExpire = null;
    await user.save();

    return res.json({ msg: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {

  try {

    const { username, password } = req.body;

    const normalizedUsername = String(username || '').trim();
    const escapedUsername = normalizedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // หา user (case-insensitive & trim-robust)
    const user = await User.findOne({
      $or: [
        { username: { $regex: '^' + escapedUsername + '$', $options: 'i' } },
        { email: { $regex: '^' + escapedUsername + '$', $options: 'i' } }
      ]
    });

    if (!user) {
      return res.status(400).json({
        msg: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    // เช็ครหัสผ่าน
    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      return res.status(400).json({
        msg: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      });
    }

    if (!user.isVerified) {
      if (!user.otpRef) {
        user.otpRef = generateOtpRef();
        await user.save();
      }
      return res.status(400).json({
        msg: 'Please verify OTP first',
        needsOtp: true,  // เพิ่ม flag เพื่อบอก front-end
        email: user.email, // ส่ง email กลับไปเพื่อใช้ในหน้า verify-otp
        otpRef: user.otpRef
      });
    }

    // สร้าง TOKEN
    const token = jwt.sign(
      {
        id: user._id,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      {
        expiresIn: '7d'
      }
    );

    res.json({
      msg: 'Login success',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      msg: 'Server error'
    });

  }

});


const authMiddleware = (req, res, next) => {

  try {

    const authHeader = req.headers.authorization;

    if (!authHeader) {

      return res.status(401).json({
        msg: 'No token'
      });

    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.user = decoded;

    next();

  } catch (err) {

    return res.status(401).json({
      msg: 'Invalid token'
    });

  }

};

const adminMiddleware = (req, res, next) => {

  if (req.user.role !== 'admin') {

    return res.status(403).json({
      msg: 'Admin only'
    });

  }

  next();

};

app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password');

    if (!user) {
      return res.status(404).json({
        msg: 'User not found'
      });
    }

    // Evaluate dynamic badge rules and award qualifying badges
    await checkAndAwardBadges(user);

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      msg: 'Server error'
    });
  }
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { username, email, otp } = req.body;
    const currentUserId = req.user.id;

    if (!username || !email) {
      return res.status(400).json({ msg: 'Username and email are required' });
    }

    const trimmedUsername = String(username).trim();
    const trimmedEmail = String(email).trim();

    if (!trimmedUsername || !trimmedEmail) {
      return res.status(400).json({ msg: 'Username and email cannot be empty' });
    }

    if (trimmedUsername.length > 10) {
      return res.status(400).json({ msg: 'Username must not exceed 10 characters' });
    }

    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;
    if (!gmailRegex.test(trimmedEmail)) {
      return res.status(400).json({ msg: 'Email must be a valid Gmail address (e.g. user@gmail.com)' });
    }

    const escapedUsername = trimmedUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEmail = trimmedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Check for duplicate username or email with other users
    const duplicate = await User.findOne({
      _id: { $ne: currentUserId },
      $or: [
        { username: { $regex: '^' + escapedUsername + '$', $options: 'i' } },
        { email: { $regex: '^' + escapedEmail + '$', $options: 'i' } }
      ]
    });

    if (duplicate) {
      const isUsernameDuplicate = duplicate.username.toLowerCase() === trimmedUsername.toLowerCase();
      const isEmailDuplicate = duplicate.email.toLowerCase() === trimmedEmail.toLowerCase();

      if (isUsernameDuplicate && isEmailDuplicate) {
        return res.status(400).json({ msg: 'Username and email are already in use' });
      } else if (isUsernameDuplicate) {
        return res.status(400).json({ msg: 'Username is already in use' });
      } else {
        return res.status(400).json({ msg: 'Email is already in use' });
      }
    }

    // Update user profile
    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const isEmailChanging = user.email.toLowerCase() !== trimmedEmail.toLowerCase();

    if (isEmailChanging) {
      if (!otp) {
        const emailOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpRef = generateOtpRef();
        user.otp = emailOtp;
        user.otpRef = otpRef;
        user.otpExpire = Date.now() + 5 * 60 * 1000;
        await user.save();

        await sendOtpEmailHtml({
          to: trimmedEmail,
          subject: 'Verify Your New Email Address - CookQuest',
          purpose: 'Email Update Verification',
          otp: emailOtp,
          refCode: otpRef,
          expireMinutes: 5
        });

        return res.json({
          status: 'OTP_SENT',
          otpRef,
          msg: 'Verification OTP has been sent to your new email address. Please enter it to complete the update.'
        });
      } else {
        const normalizedOtp = String(otp).trim();
        if (user.otp !== normalizedOtp) {
          return res.status(400).json({ msg: 'Invalid OTP' });
        }
        if (user.otpExpire < Date.now()) {
          return res.status(400).json({ msg: 'OTP has expired' });
        }
        user.otp = null;
        user.otpRef = null;
        user.otpExpire = null;
      }
    }

    user.username = trimmedUsername;
    user.email = trimmedEmail;
    await user.save();

    res.json({
      msg: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

async function addExpToProfile(req, res, expToAdd) {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const currentExp = Number(user.exp || 0);
    user.exp = currentExp + Number(expToAdd || 0);

    // Re-calculate Level and Rank
    const levelSystem = {
      1: { rank: 'BRONZE Chef', minXP: 0, maxXP: 1500 },
      2: { rank: 'SILVER Chef', minXP: 1501, maxXP: 3000 },
      3: { rank: 'GOLD Chef', minXP: 3001, maxXP: 5000 },
      4: { rank: 'PLATINUM Chef', minXP: 5001, maxXP: 8000 },
      5: { rank: 'DIAMOND Chef', minXP: 8001, maxXP: 12000 },
      6: { rank: 'MASTER Chef', minXP: 12001, maxXP: Infinity }
    };

    for (let level = 6; level >= 1; level--) {
      if (user.exp >= levelSystem[level].minXP) {
        user.level = level;
        user.rank = levelSystem[level].rank;
        break;
      }
    }

    await checkAndAwardBadges(user);

    await user.save();
    res.json({ msg: 'EXP & Level updated successfully', user });
  } catch (err) {
    console.error('Error updating EXP:', err);
    res.status(500).json({ msg: 'Server error' });
  }
}

app.post('/api/profile/add-exp', authMiddleware, async (req, res) => {
  return addExpToProfile(req, res, req.body.expToAdd);
});

app.post('/api/profile/add-badge', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { badgeName, badgeIcon, userId } = req.body;
    const targetUserId = userId || req.user.id;
    const user = await User.findById(targetUserId);

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Initialize badges array if it doesn't exist
    if (!user.badges) {
      user.badges = [];
    }

    // Check if badge already exists
    const hasBadge = user.badges.some(b => b.name === badgeName);
    if (!hasBadge) {
      user.badges.push({ name: badgeName, icon: badgeIcon, earnedAt: new Date() });
      await user.save();
      return res.json({ msg: 'Badge added successfully', user });
    } else {
      return res.status(400).json({ msg: 'Badge already collected' });
    }
  } catch (err) {
    console.error('Error adding badge:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.get('/api/badges', async (req, res) => {
  try {
    const badges = await Badge.find().sort({ createdAt: -1 });
    res.json(badges);
  } catch (err) {
    console.error('Error fetching badges:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.post('/api/badges', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, icon, desc, ruleType, ruleValue, ruleCategory } = req.body;
    if (!name || !icon || !desc) {
      return res.status(400).json({ msg: 'Please provide name, icon, and desc' });
    }
    const exists = await Badge.findOne({ name });
    if (exists) {
      return res.status(400).json({ msg: 'Badge with this name already exists' });
    }
    const badge = new Badge({ name, icon, desc, ruleType, ruleValue, ruleCategory });
    await badge.save();
    res.status(201).json(badge);
  } catch (err) {
    console.error('Error creating badge:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.put('/api/badges/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, icon, desc, ruleType, ruleValue, ruleCategory } = req.body;
    const badge = await Badge.findById(req.params.id);
    if (!badge) {
      return res.status(404).json({ msg: 'Badge not found' });
    }
    if (name) badge.name = name;
    if (icon) badge.icon = icon;
    if (desc) badge.desc = desc;
    if (ruleType) badge.ruleType = ruleType;
    if (ruleValue !== undefined) badge.ruleValue = ruleValue;
    if (ruleCategory !== undefined) badge.ruleCategory = ruleCategory;
    await badge.save();
    res.json(badge);
  } catch (err) {
    console.error('Error updating badge:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.delete('/api/badges/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const badge = await Badge.findById(req.params.id);
    if (!badge) {
      return res.status(404).json({ msg: 'Badge not found' });
    }
    await Badge.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Badge deleted successfully' });
  } catch (err) {
    console.error('Error deleting badge:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').lean();
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

app.get('/api/menus', async (req, res) => {
  try {
    const full = req.query.full === 'true';
    if (full) {
      const menus = await Menu.find().lean();
      return res.json(menus);
    }

    const menus = await Menu.aggregate(Menu.LIST_AGGREGATION);
    res.json(menus);
  } catch (error) {
    console.error('Error fetching menus:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/menus/images', async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return res.json({});
    }

    const menus = await Menu.find({ _id: { $in: ids } }).select('imageURL').lean();
    const images = {};
    menus.forEach((menu) => {
      images[String(menu._id)] = menu.imageURL || '';
    });
    res.json(images);
  } catch (error) {
    console.error('Error fetching menu images:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/menus/:id/image', async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id).select('imageURL').lean();
    if (!menu) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    res.json({ imageURL: menu.imageURL || '' });
  } catch (error) {
    console.error('Error fetching menu image:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/menus/:id', async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    res.json(menu);
  } catch (error) {
    console.error('Error fetching menu:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/menus', authMiddleware, adminMiddleware, upload.any(), async (req, res) => {
  try {
    const processedBody = await processMenuImages(req, 'CookQuest/menu');
    const menu = new Menu(processedBody);
    await menu.save();
    res.status(201).json(menu);
  } catch (error) {
    console.error('Error creating menu:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/menus/:id', authMiddleware, adminMiddleware, upload.any(), async (req, res) => {
  try {
    const processedBody = await processMenuImages(req, 'CookQuest/menu');
    const menu = await Menu.findByIdAndUpdate(req.params.id, processedBody, { new: true, runValidators: true });
    if (!menu) {
      return res.status(404).json({ error: 'Menu not found' });
    }
    res.json(menu);
  } catch (error) {
    console.error('Error updating menu:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/menus/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const menu = await Menu.findByIdAndDelete(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Menu not found' });
    }

    const menuName = (menu.menuName || '').trim();

    // Also delete requests and submissions with this menuName
    const requestsToDelete = await Request.find({ menuName: menuName }).select('_id').lean();
    const reqIdsToDelete = requestsToDelete.map(r => r._id);
    await Submission.deleteMany({ requestId: { $in: reqIdsToDelete } });
    await Request.deleteMany({ _id: { $in: reqIdsToDelete } });

    // Also delete favorites pointing to this menu
    await Favorite.deleteMany({ menuId: req.params.id });

    const escapedName = menuName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const questQuery = {
      tags: { $elemMatch: { $regex: `^${escapedName}$`, $options: 'i' } }
    };

    const affectedQuests = await Quest.find(questQuery);
    const updatedQuestNames = [];
    const deletedQuestNames = [];

    for (const quest of affectedQuests) {
      const filteredTags = (quest.tags || [])
        .map(tag => (typeof tag === 'string' ? tag.trim() : tag))
        .filter(tag => tag && tag.toLowerCase() !== menuName.toLowerCase());

      if (filteredTags.length === 0) {
        await Quest.findByIdAndDelete(quest._id);
        deletedQuestNames.push(quest.name);
      } else {
        quest.tags = filteredTags;
        await quest.save();
        updatedQuestNames.push(quest.name);
      }
    }

    res.json({
      message: 'Menu deleted successfully',
      menuName,
      affectedQuests: updatedQuestNames,
      deletedQuests: deletedQuestNames
    });
  } catch (error) {
    console.error('Error deleting menu:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tags', (req, res) => {
  try {
    const search = (req.query.search || '').trim().toLowerCase();
    const tags = PRESET_CATEGORIES.map(name => ({ name }));
    if (search) {
      const filtered = tags.filter(t => t.name.toLowerCase().includes(search));
      return res.json(filtered);
    }
    res.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tags', (req, res) => {
  try {
    const names = Array.isArray(req.body.name) ? req.body.name : [req.body.name];
    const createdTags = names
      .map(n => typeof n === 'string' ? n.trim() : '')
      .filter(Boolean)
      .map(name => ({ name }));
    res.status(201).json(createdTags.length === 1 ? createdTags[0] : createdTags);
  } catch (error) {
    console.error('Error creating tag:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/requests', async (req, res) => {
  try {
    const status = (req.query.status || 'all').toLowerCase();
    const allowedStatuses = ['all', 'pending', 'approved', 'rejected'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }

    const query = status === 'all' ? {} : { status };
    const requests = await Request.find(query).sort({ _id: -1 }).lean();
    const mappedRequests = requests.map(toRequestListItem);
    res.json(mappedRequests);
  } catch (error) {
    console.error('Error fetching requests:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/requests/:id/image', async (req, res) => {
  try {
    const request = await Request.findById(req.params.id).select('imageURL').lean();
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    res.json({ imageURL: request.imageURL || '' });
  } catch (error) {
    console.error('Error fetching request image:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/requests/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const allowedStatuses = ['approved', 'rejected'];

    if (!allowedStatuses.includes(normalizedStatus)) {
      return res.status(400).json({ error: 'Invalid status update' });
    }

    const request = await Request.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status && request.status !== 'pending') {
      return res.status(400).json({ error: 'Status cannot be changed after decision' });
    }

    request.status = normalizedStatus;
    await request.save();

    // Update the corresponding submission status
    await Submission.updateMany(
      { requestId: request._id },
      { $set: { status: normalizedStatus } }
    );

    // Safely get the user ID (If Request schema lacks createdBy, fallback to Submission)
    const submission = await Submission.findOne({ requestId: request._id });
    const creatorId = request.createdBy || (submission ? submission.createdBy : null);

    // Give XP and increment completed recipes if approved
    if (normalizedStatus === 'approved' && creatorId) {
      // Fetch all required database items in parallel
      const [user, menu, questModel, userMenu, allQuests, allMenus, userSubmissions] = await Promise.all([
        User.findById(creatorId),
        Menu.findOne({ menuName: request.menuName }).select('EXP').lean(),
        Quest.findOne({ name: request.menuName }).select('exp').lean(),
        UserMenu.findOne({ menuName: request.menuName }).select('EXP').lean(),
        Quest.find().select('_id name exp tags').lean(),
        Menu.find().select('menuName questIds').lean(),
        Submission.find({ createdBy: creatorId, status: 'approved', requestId: { $ne: request._id } })
          .select('requestId')
          .populate({ path: 'requestId', select: 'menuName' }).lean()
      ]);

      if (user) {
        let expReward = 100; // Default EXP fallback

        // Determine the EXP reward from parallel fetches
        if (menu && menu.EXP) {
          expReward = menu.EXP;
        } else if (questModel && questModel.exp) {
          expReward = questModel.exp;
        } else if (userMenu && userMenu.EXP) {
          expReward = userMenu.EXP;
        }

        // Build set of already approved menu names for this user (excluding the current request)
        const approvedMenuNames = new Set();
        userSubmissions.forEach(sub => {
          if (sub.requestId && sub.requestId.menuName) {
            approvedMenuNames.add(sub.requestId.menuName.toLowerCase().trim());
          }
        });

        const isMenuAlreadyCompleted = request.menuName && approvedMenuNames.has(request.menuName.toLowerCase().trim());

        if (!isMenuAlreadyCompleted) {
          const currentExp = Number(user.exp || 0);
          user.exp = currentExp + expReward;
          user.completedRecipes = (user.completedRecipes || 0) + 1;
          console.log(`User ${user.username} completed menu: ${request.menuName}. Awarded ${expReward} EXP.`);
        } else {
          console.log(`User ${user.username} already completed menu: ${request.menuName}. No extra EXP awarded.`);
        }

        // Check Quest completion and award Quest EXP
        try {
          if (request.menuName) {
            approvedMenuNames.add(request.menuName.toLowerCase().trim());
          }

          for (const quest of allQuests) {
            const questIdStr = quest._id.toString();
            const hasCompleted = user.completedQuests && user.completedQuests.map(q => q.toString()).includes(questIdStr);
            if (hasCompleted) {
              continue;
            }

            const relatedMenus = allMenus.filter(m => {
              const hasQuestId = m.questIds && m.questIds.includes(questIdStr);
              const hasTagMatch = quest.tags && quest.tags.some(tag => tag.toLowerCase() === (m.menuName || '').toLowerCase());
              return hasQuestId || hasTagMatch;
            });

            if (relatedMenus.length > 0) {
              let questCompleted = true;
              for (const m of relatedMenus) {
                if (!approvedMenuNames.has((m.menuName || '').toLowerCase().trim())) {
                  questCompleted = false;
                  break;
                }
              }

              if (questCompleted) {
                const questExp = quest.exp || 0;
                user.exp = Number(user.exp || 0) + questExp;
                if (!user.completedQuests) {
                  user.completedQuests = [];
                }
                user.completedQuests.push(questIdStr);
                user.markModified('completedQuests');
                console.log(`User ${user.username} completed quest: ${quest.name}. Awarded ${questExp} EXP.`);
              }
            }
          }
        } catch (qErr) {
          console.error('Error checking quest completions:', qErr);
        }

        // Re-calculate Level and Rank
        const levelSystem = {
          1: { rank: 'BRONZE Chef', minXP: 0, maxXP: 1500 },
          2: { rank: 'SILVER Chef', minXP: 1501, maxXP: 3000 },
          3: { rank: 'GOLD Chef', minXP: 3001, maxXP: 5000 },
          4: { rank: 'PLATINUM Chef', minXP: 5001, maxXP: 8000 },
          5: { rank: 'DIAMOND Chef', minXP: 8001, maxXP: 12000 },
          6: { rank: 'MASTER Chef', minXP: 12001, maxXP: Infinity }
        };

        for (let level = 6; level >= 1; level--) {
          if (user.exp >= levelSystem[level].minXP) {
            user.level = level;
            user.rank = levelSystem[level].rank;
            break;
          }
        }

        // Evaluate dynamic badge rules and award qualifying badges
        await checkAndAwardBadges(user);

        await user.save();
      }
    }

    io.emit('status_updated', { requestId: request._id, status: normalizedStatus });

    res.json(request);
  } catch (error) {
    console.error('Error updating request status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/quests', async (req, res) => {
  try {
    const quests = await Quest.find().lean();
    res.json(quests);
  } catch (error) {
    console.error('Error fetching quests:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/quests', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const quest = new Quest(req.body);
    await quest.save();
    res.status(201).json(quest);
  } catch (error) {
    console.error('Error creating quest:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/quests/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const quest = await Quest.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!quest) {
      return res.status(404).json({ error: 'Quest not found' });
    }
    res.json(quest);
  } catch (error) {
    console.error('Error updating quest:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/quests/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const quest = await Quest.findByIdAndDelete(req.params.id);
    if (!quest) {
      return res.status(404).json({ error: 'Quest not found' });
    }
    res.json({ message: 'Quest deleted successfully' });
  } catch (error) {
    console.error('Error deleting quest:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/submissions', upload.any(), async (req, res) => {
  try {
    const { body, submissionImageUrl, requestImageUrl } = await processSubmissionImages(req);
    const { menuName, randomQuests, tasteRating, tasteTags, review, createdBy } = body;

    const request = new Request({
      menuName,
      randomQuests,
      imageURL: requestImageUrl,
      tasteRating,
      tasteTags,
      review,
      status: 'pending',
      submittedAt: new Date(),
      createdBy
    });
    await request.save();

    const submission = new Submission({
      requestId: request._id,
      imageURL: submissionImageUrl,
      tasteRating,
      tasteTags,
      review,
      status: 'pending',
      createdBy
    });
    await submission.save();

    io.emit('new_submission', { request, submission });

    res.status(201).json({ request, submission });
  } catch (error) {
    console.error('Error creating submission:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/submissions/:id', upload.any(), async (req, res) => {
  try {
    const { body, submissionImageUrl, requestImageUrl } = await processSubmissionImages(req);
    const { tasteRating, tasteTags, review } = body;

    const submission = await Submission.findByIdAndUpdate(
      req.params.id,
      { imageURL: submissionImageUrl, tasteRating, tasteTags, review, editedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Also update the corresponding Request in database
    if (submission.requestId) {
      const request = await Request.findByIdAndUpdate(
        submission.requestId,
        { imageURL: requestImageUrl, tasteRating, tasteTags, review },
        { new: true }
      );

      // Emit socket event so that admin page reloads immediately
      io.emit('new_submission', { request, submission });
    }

    res.json(submission);
  } catch (error) {
    console.error('Error updating submission:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/submissions/:id', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending submissions can be deleted' });
    }

    const requestId = submission.requestId;

    // Delete submission and request
    await Submission.findByIdAndDelete(req.params.id);
    if (requestId) {
      await Request.findByIdAndDelete(requestId);
    }

    // Emit socket event to notify other clients (e.g. admin page)
    io.emit('status_updated', { requestId: requestId, status: 'deleted' });

    res.json({ message: 'Submission deleted successfully' });
  } catch (error) {
    console.error('Error deleting submission:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { requestId, menuName, userId, summary } = req.query;
    const query = {};
    if (requestId) query.requestId = requestId;
    if (userId) query.createdBy = userId;

    // Filter by menuName at database level rather than populating and filtering in memory
    if (menuName) {
      const reqQuery = { menuName };
      if (userId) reqQuery.createdBy = userId;
      const requests = await Request.find(reqQuery).select('_id').lean();
      const requestIds = requests.map(r => r._id);
      query.requestId = { $in: requestIds };
    }

    const useSummary = summary === 'true' || (userId && !menuName && !requestId);

    let historyQuery = Submission.find(query);
    if (useSummary) {
      historyQuery = historyQuery.select('-imageURL');
    }

    const history = await historyQuery
      .populate({
        path: 'requestId',
        select: 'menuName randomQuests status'
      })
      .sort({ _id: -1 });

    // Filter out submissions where requestId didn't match
    const filteredHistory = history.filter(sub => sub.requestId != null);

    res.json(filteredHistory);
  } catch (error) {
    console.error('Error fetching history:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/favorites/toggle', async (req, res) => {
  try {
    const { userId, menuId } = req.body;
    if (!userId || !menuId) {
      return res.status(400).json({ error: 'Missing userId or menuId' });
    }

    const existing = await Favorite.findOne({ userId, menuId });
    if (existing) {
      await Favorite.findByIdAndDelete(existing._id);
      return res.json({ status: 'unfavorited', menuId });
    } else {
      const fav = new Favorite({ userId, menuId });
      await fav.save();
      return res.status(201).json({ status: 'favorited', menuId });
    }
  } catch (error) {
    console.error('Error toggling favorite:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/favorites', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    const favorites = await Favorite.find({ userId }).select('userId menuId createdAt').lean();
    res.json(favorites);
  } catch (error) {
    console.error('Error fetching favorites:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// UserMenu API Endpoints (Custom Recipes)
// ==========================================

app.get('/api/usermenus', async (req, res) => {
  try {
    const { userId } = req.query;
    const filter = userId ? { createdBy: userId } : {};
    const menus = await UserMenu.find(filter).sort({ _id: -1 });
    res.json(menus);
  } catch (error) {
    console.error('Error fetching usermenus:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/usermenus', upload.any(), async (req, res) => {
  try {
    const processedBody = await processMenuImages(req, 'CookQuest/userMenu');
    const menu = new UserMenu(processedBody);
    await menu.save();
    res.status(201).json(menu);
  } catch (error) {
    console.error('Error creating usermenu:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/usermenus/:id', upload.any(), async (req, res) => {
  try {
    const processedBody = await processMenuImages(req, 'CookQuest/userMenu');
    const menu = await UserMenu.findByIdAndUpdate(req.params.id, processedBody, { new: true, runValidators: true });
    if (!menu) {
      return res.status(404).json({ error: 'UserMenu not found' });
    }
    res.json(menu);
  } catch (error) {
    console.error('Error updating usermenu:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/usermenus/:id', async (req, res) => {
  try {
    const menu = await UserMenu.findByIdAndDelete(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'UserMenu not found' });
    }
    res.json({ message: 'UserMenu deleted successfully' });
  } catch (error) {
    console.error('Error deleting usermenu:', error.message);
    res.status(500).json({ error: error.message });
  }
});