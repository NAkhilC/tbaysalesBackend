const express = require("express");
const multer = require("multer");
const { memoryStorage } = require("multer");
const bodyParser = require("body-parser");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const AWS = require("aws-sdk");
const jwt = require("jsonwebtoken");
const { uploadToS3 } = require("./s3-service");
const dotenv = require("dotenv");
const sessions = require("express-session");
const cookieParser = require("cookie-parser");
const WebSocket = require("ws");
const http = require("http");
const socketIO = require("socket.io");
const { Expo } = require("expo-server-sdk");
const bcrypt = require("bcrypt");
const {
  v1: uuidv1,
  v4: uuidv4,
} = require('uuid');

const {
  getItems,
  verifyUser,
  getUserItems,
  getListingById,
  getSavedInterested,
  interestedItems,
  savedItems,
  getItemsForMap,
  getChatsByUserId,
  saveChatMessages,
  getUsersMessages,
  saveUserChatMessages,
  sendPushNotifications,
  updateUserNotifications,
  filterDataWithUserPreference,
  updateUserPreferenceAndSortData,
  createConversationIdForUserChats,
  gettAppUser

} = require("./services/getItems");
const { encyrptPassword, comparePassword } = require("./services/passwordManager");
const nodemailer = require('nodemailer');


const app = express();
app.use(express.json());
app.use(bodyParser.json());
const server = http.createServer(app);
const io = socketIO(server);
const users = {};

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", (username, listingId) => {
    users[socket.id] = username + listingId;
    socket.broadcast.emit("userJoined", username);
  });

  socket.on("sendMessage", async ({ _id, createdAt, sender, receiver, message, conversationId, listingId }) => {
    const receiverSocketId = Object.keys(users).find((socketId) => users[socketId] === receiver + listingId);
    const senderSocketId = Object.keys(users).find((socketId) => users[socketId] === sender + listingId);
    if (conversationId) {
      io.to(receiverSocketId).emit("receiveMessage", {
        conversationId: conversationId,
        status: 200,
        _id: _id,
        text: message,
        sender: sender,
        createdAt: createdAt
      });
      if (!receiverSocketId) {
        console.log("******");
        sendPushNotifications(receiver, message);
        //send notification
      }
      await saveUserChatMessages(sender, _id, message, conversationId);
    } else {
      //create conversation id , save messsage and emit
      let conversationStatus = await createConversationIdForUserChats(sender, receiver, _id, listingId);
      if (conversationStatus.status === 200) {
        io.to(senderSocketId).emit("updateConversationId", {
          conversationId: conversationStatus.conversationId,
          status: conversationStatus.status,
          _id: _id,
          context: message,
          sender: sender,
          timeStamp: createdAt
        });
        io.to(receiverSocketId).emit("receiveMessage", {
          conversationId: conversationId,
          status: 200,
          _id: _id,
          text: message,
          sender: sender,
          createdAt: createdAt
        });
        await saveUserChatMessages(sender, _id, message, conversationStatus.conversationId);
        if (!receiverSocketId) {
          //send notification
          sendPushNotifications(receiver, message);
        }
      } else {
        io.to(senderSocketId).emit("updateConversationId", {
          conversationId: conversationStatus.conversationId,
          status: conversationStatus.status
        });
      }

    }
  });

  socket.on("disconnect", () => {
    const username = users[socket.id];
    if (username) {
      delete users[socket.id];
      socket.broadcast.emit("userLeft", username);
    }
  });
});

app.use(
  sessions({
    secret: "thisistbayAppSecret",
    saveUninitialized: true,
    resave: false,
  })
);

app.use(cookieParser());

dotenv.config();

const storage = memoryStorage();
const upload = multer({ storage });

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

//login
app.post("/login", async (req, res, next) => {
  let jwtSecretKey = process.env.JWT_SECRET_KEY;
  if (req && req.body && req.body.username && req.body.password) {
    try {
      const appuser = await gettAppUser(req.body.username);
      if (appuser && appuser.status === 200) {
        let passwordStatus;
        if (req.body?.isPersistentLogin) {
          passwordStatus = (req.body.password === appuser.data.password);
        } else {
          passwordStatus = await comparePassword(req.body.password, appuser.data.password);
        }

        if (passwordStatus) {
          const generateTokenData = {
            time: Date(),
            userId: appuser.data.email,
            name: appuser.data.name,
          };
          const token = await jwt.sign(generateTokenData, jwtSecretKey);
          let response = { ...appuser.data, token: token };
          req.session.user = appuser.data.email;
          req.session.cookie.maxAge = Number(process.env.COOKIE_MAXAGE);
          res.send({ status: 200, data: response });
        } else {
          res.send({ status: 401, data: "AUTHENTOCATION_ERROR" });
        }
      } else {
        res.send({ status: 404, data: "NO_USER_FOUND" });
      }
    } catch (e) {
      res.send({ status: 500, data: "something went wrong" });
    }
  } else {
    res.send({ status: 500, data: "something went wrong" });
  }
});

const isLoggedIn = (req, res, next) => {
  if (req && req.session && req.session.user) {
    next();
  } else {
    res.send({ status: 401, data: "something went wrong" });
  }
}

//home-getitems
app.get("/items", isLoggedIn, async (req, res, next) => {
  const userId = req.session && req.session.user;
  const expo = new Expo({ accessToken: process.env.SERVER_PUSH_APN_TOKEN });
  //console.log(a);
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  let data = await getUserItems(userId);
  res.send(data);
});

//get-chats-for-user
app.get("/userChats/:id", isLoggedIn, async (req, res, next) => {
  const conversationId = req.params.id;
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  if (conversationId) {
    let data = await getUsersMessages(conversationId);
    res.send(data);
  } else {
    res.send({ satus: 204, data: '' })
  }
});

//make a post
app.post("/upload", isLoggedIn, upload.array("file", 12), async (req, res) => {
  let saleItem = JSON.parse(req.body.data);
  saleItem.images = [];
  saleItem.userId = req.session.user;

  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: "us-east-1",
  });

  let listingId = new Date().getTime().toString(36) + Math.random().toString(36).slice(2);
  saleItem.listingId = listingId;
  saleItem.userId = req.session.user || 'Test1@gmail.com';
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  const params = {
    TableName: process.env.SALEDATA,
    Item: saleItem,
  };

  req.files.map((file) => {
    try {
      uploadToS3({ file }, listingId);
      saleItem.images.push(listingId + file.originalname);
    } catch (e) {
      res.status(500).json({ message: "Something went wrong while uploding images" });
    }
  });

  await dynamodb
    .put(params)
    .promise()
    .then((data) => { res.send({ status: 200, data: "Listed Item" }) })
    .catch((err) => { res.send({ status: 500, data: "Error listing an item" }) });
});

app.post("/generateToken", (req, res, next) => {
  res.send({ status: 200, token: token });
});

//signup
app.post("/signUp", async (req, res) => {
  if (req && req.body && req.body.email) {
    AWS.config.update({
      accessKeyId: process.env.ACCESS_KEY_ID,
      secretAccessKey: process.env.SECRET_ACCESS_KEY,
      region: process.env.REGION,
    });
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      port: 587,
      auth: {
        user: process.env.EMAIL, // Your Gmail email address
        pass: process.env.PASSWORD // Your Gmail password or App Password if 2-factor authentication is enabled
      }
    });
    const otp = Math.floor(Math.random() * 1000000);
    const mailOptions = {
      from: process.env.EMAIL,    // Sender's email address
      to: req.body.email, // Recipient's email address
      subject: 'Node.js Email',   // Email subject
      text: `Hello, This is your one time passcode ${otp}` // Email body (plain text)
    };

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email: ' + error);
      } else {
        console.log('Email sent: ' + JSON.stringify(info));
      }
    });

    try {
      const appuser = await gettAppUser(req.body.email);
      if (appuser && appuser.status === 200) {
        res.send({ data: "USER_EXIST", status: 404 })
      } else {
        let requestBody = JSON.parse(JSON.stringify(req.body));
        requestBody.password = await encyrptPassword(requestBody.password);
        requestBody.otp = otp;
        requestBody.verified = false;
        const params = {
          TableName: process.env.USERS,
          Item: requestBody,
        };
        await dynamodb
          .put(params)
          .promise()
          .then((data) => {
            res.send({ data: "success", status: 200 })
          })
          .catch((err) => {
            res.send({ data: "something wrong", status: 500 })
          });
      }
    }
    catch (e) {
      res.send({ data: "something went wrong", status: 500 })
    }
  } else {
    res.send({ data: "something went wrong", status: 500 })
  }
});

//verify otp
app.post("/verifyOTP", async (req, res) => {
  if (req.body && req.body.email && req.body.otp) {
    try {
      const appuser = await gettAppUser(req.body.email);
      if (appuser && appuser.status === 200) {
        if (Number(appuser.data.otp) === Number(req.body.otp)) {
          const verifyStatus = await verifyUser({ email: req.body.email, otp: req.body.otp });
          if (verifyStatus.status === 200) {
            res.send({ data: "success", status: 200 })
          } else {
            res.send({ data: "something went wrong", status: 500 })
          }
        } else {
          res.send({ status: 404, data: "OTP_NOT_VALIDATED" });
        }
      } else {
        res.send({ status: 404, data: "NO_USER_FOUND" });
      }
    } catch (e) {
      console.log(e);
      res.send({ data: "something went wrong", status: 500 })
    }
  }
});

//push notification
app.post("/pushNotifications", isLoggedIn, async (req, res) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const userId = req.session.user || 'Test1@gmail.com';
  const userData = await updateUserNotifications(userId, req.body)
  // if (req.session && req.session.user) {
  //   await updateUserPreferenceAndSortData(req.session.user, req.body)
  // } else {
  //   res.sendStatus(204);
  // }

  // if (filterItems.status === 200) {
  //   res.send({ data: filterItems.data, status: 200 })
  // } else {
  //   res.send({ data: [], status: 500 })
  // }
  console.log(userData);
  res.send({ data: userData, status: 200 })

});

//userPreference
app.post("/userPreference", isLoggedIn, async (req, res) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const userId = req.session.user || 'Test1@gmail.com';
  const filterItems = await updateUserPreferenceAndSortData(userId, req.body)
  if (filterItems.status === 200) {
    res.send({ data: filterItems.data, status: 200 })
  } else {
    res.send({ data: [], status: 500 })
  }


});

//userPreference
app.post("/filterData", async (req, res) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const userId = req.session.user || 'Test1@gmail.com';
  try {
    const filterItems = await filterDataWithUserPreference(userId, req.body)
    if (filterItems.status === 200) {
      res.send({ data: filterItems.data, status: 200 })
    } else {
      res.send({ data: [], status: 500 })
    }
  } catch (e) {
    res.send({ status: 500, message: "Error finding the listing." });
  }


});

//get item Id
app.get("/item/:id", isLoggedIn, async (req, res) => {
  const listingId = req.params.id;
  if (listingId) {
    AWS.config.update({
      accessKeyId: process.env.ACCESS_KEY_ID,
      secretAccessKey: process.env.SECRET_ACCESS_KEY,
      region: process.env.REGION,
    });
    res.send(await getListingById(listingId));
  } else {
    res.send({ status: 500, message: "Error finding the listing." });
  }
});

app.get("/getChatsForUser", isLoggedIn, async (req, res) => {
  const userId = req.session.user;
  if (userId) {
    res.send(await getChatsByUserId(userId));
  } else {
    res.send({ status: 500, message: "Error finding the listing." });
  }
});

app.get("/items/getSavedInterested", isLoggedIn, async (req, res, next) => {
  //res.send(await getSavedInterested("Hello@gmail.com"));
  if (req.session && req.session.user) {
    res.send(await getSavedInterested(req.session.user));
  } else {
    res.send({ status: 500, data: "something went wrong" });
  }
});

app.post("/items/interested", isLoggedIn, async (req, res, next) => {
  //let result = await interestedItems("Hello@gmail.com", req.body.listingId);
  if (req.session && req.session.user) {
    let result = await interestedItems(req.session.user, req.body.listingId);
    if (result.status === 200) {
      res.send(result);
    } else {
      res.send({ status: 500, data: "something went wrong" });
    }
  } else {
    res.send({ status: 500, data: "something went wrong" });
  }
});

app.post("/items/saved", isLoggedIn, async (req, res, next) => {
  if (req.session && req.session.user) {
    let result = await savedItems(req.session.user, req.body.listingId);
    if (result.status === 200) {
      res.send({ status: 200 });
    } else {
      res.send({ status: 204 });
    }
  } else {
    res.sendStatus(204);
  }
});

app.get("/items/mapView", isLoggedIn, async (req, res, next) => {
  //console.log(req.session.user);
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  //if (req.session && req.session.user) {
  let result = await getItemsForMap();
  if (result.status === 200) {
    res.send({ status: 200, data: result });
  } else {
    res.send({ status: 204 });
  }
  // } else {
  //   res.sendStatus(204);
  // }
});

server.listen(process.env.PORT, async () => {
  //await init();
  console.log(process.env.PORT);
  console.log("App running on http://localhost:3000");
});
