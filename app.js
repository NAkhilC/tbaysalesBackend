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
const {
  getItems,
  getListingById,
  getSavedInterested,
  interestedItems,
  savedItems,
  getItemsForMap,
} = require("./services/getItems");

const app = express();
// app.use(express.json());
// app.use(bodyParser.json());
const server = http.createServer(app);
const io = socketIO(server);
const users = {};

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", (username) => {
    console.log(username, "***");
    users[socket.id] = username;
    socket.broadcast.emit("userJoined", username);
  });

  socket.on("sendMessage", ({ sender, receiver, message }) => {
    const receiverSocketId = Object.keys(users).find((socketId) => users[socketId] === receiver);
    console.log(receiverSocketId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receiveMessage", {
        sender,
        message,
      });
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
app.post("/login", (req, res, next) => {
  let jwtSecretKey = process.env.JWT_SECRET_KEY;

  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let searchId = {
    TableName: "users",
    FilterExpression: "#email = :email",
    ExpressionAttributeNames: {
      "#email": "email",
    },
    ExpressionAttributeValues: {
      ":email": req.body.username,
    },
  };

  dynamodb.scan(searchId, async function (err, data) {
    if (err) {
      res.send(400).json({ message: "Something wrong" });
    } else {
      if (data.Count > 0) {
        let generateTokenData = {
          time: Date(),
          userId: data.Items[0].email,
          name: data.Items[0].name,
        };
        const token = jwt.sign(generateTokenData, jwtSecretKey);
        let responseContext = {
          ...data.Items[0],
          token: token,
        };
        req.session.user = data.Items[0].email;
        req.session.cookie.maxAge = Number(process.env.COOKIE_MAXAGE);
        res.send({ status: 200, data: responseContext });
      } else {
        res.sendStatus(204);
      }
    }
  });
});

//home-getitems
app.get("/items", async (req, res, next) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  let data = await getItems();
  res.send(data);
});

//make a post
app.post("/upload", upload.array("file", 12), async (req, res) => {
  let saleItem = JSON.parse(req.body.data);
  saleItem.images = [];
  saleItem.userId = req.session.user;

  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });

  let listingId = new Date().getTime().toString(36) + Math.random().toString(36).slice(2);
  saleItem.listingId = listingId;

  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  const params = {
    TableName: "saleData",
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
    .then((data) => {})
    .catch((err) => {});

  res.status(200).json({
    message: "success!",
  });
});

app.post("/generateToken", (req, res, next) => {
  res.send({ status: 200, token: token });
});

//signup
app.post("/signUp", async (req, res) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let searchId = {
    TableName: "users",
    FilterExpression: "#email = :email",
    ExpressionAttributeNames: {
      "#email": "email",
    },
    ExpressionAttributeValues: {
      ":email": req.body.email,
    },
  };

  dynamodb.scan(searchId, async function (err, data) {
    if (err) {
      res.send(500).json({ message: "Something wrong" });
    } else {
      if (data.Count > 0) {
        res.status(204).send("User already exists");
      } else {
        const params = {
          TableName: "users",
          Item: req.body,
        };

        await dynamodb
          .put(params)
          .promise()
          .then((data) => {
            res.status(200).json({ message: "success!" });
          })
          .catch((err) => {
            res.status(500).json({ message: "something went Wrong" });
          });
      }
    }
  });
});

//get item Id
app.get("/item/:id", async (req, res) => {
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

app.get("/items/getSavedInterested", async (req, res, next) => {
  //res.send(await getSavedInterested("Hello@gmail.com"));
  if (req.session && req.session.user) {
    res.send(await getSavedInterested(req.session.user));
  } else {
    res.sendStatus(204);
  }
});

app.post("/items/interested", async (req, res, next) => {
  console.log(req.session.user);
  //let result = await interestedItems("Hello@gmail.com", req.body.listingId);
  if (req.session && req.session.user) {
    let result = await interestedItems(req.session.user, req.body.listingId);
    if (result.status === 200) {
      res.send({ status: 200 });
    } else {
      res.send({ status: 204 });
    }
  } else {
    res.sendStatus(204);
  }
});

app.post("/items/saved", async (req, res, next) => {
  console.log(req.session.user);
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

app.get("/items/mapView", async (req, res, next) => {
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

server.listen(3000, async () => {
  //await init();
  console.log(process.env.PORT);
  console.log("App running on http://localhost:3000");
});
