const mongoose = require("mongoose");
const url = `mongodb://0.0.0.0:27017`;
var Schema = mongoose.Schema;
const connectionParams = {
  useNewUrlParser: true,
};

const connectToDb = async () => {
  await mongoose
    .connect(url, connectionParams)
    .then(() => {
      console.log("Connected to the database ");
    })
    .catch((err) => {
      console.error(`Error connecting to the database. n${err}`);
    });

  return mongoose.connection;
};

module.exports = { connectToDb };
