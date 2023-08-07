const AWS = require("aws-sdk");
const { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { default: axios } = require("axios");

const getItems = async () => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  let searchId = {
    TableName: "saleData",
  };

  let documents = await dynamodb.scan(searchId).promise();
  if (documents.Items.length > 0) {
    for (let item of documents.Items) {
      try {
        let images = await generatePreSignedUrlsForImages(item.images);
        item.images = images;
      } catch (err) {
        return { status: 500, error: err?.message };
      }
    }
    return { status: 200, data: documents.Items };
  } else {
    return { status: 204, data: [] };
  }
};

const getListingById = async (listingId) => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let searchId = {
    TableName: "saleData",
    FilterExpression: "#listingId = :listingId",
    ExpressionAttributeNames: {
      "#listingId": "listingId",
    },
    ExpressionAttributeValues: {
      ":listingId": listingId,
    },
  };

  let documents = await dynamodb.scan(searchId).promise();
  if (documents.Items.length > 0) {
    try {
      let images = await generatePreSignedUrlsForImages(documents.Items[0].images);
      documents.Items[0].images = images;
    } catch (err) {
      return { status: 500, error: err?.message };
    }
    return { status: 200, data: documents.Items[0] };
  } else {
    return { status: 204, data: [] };
  }
};

//get presigned urls for the images
const generatePreSignedUrlsForImages = async (images = []) => {
  const s3 = new S3Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: "AKIAW7EO5CI5BDGH7UNF",
      secretAccessKey: "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",
    },
  });

  const presignedUrls = await Promise.all(
    images.map((key) => {
      const command = new GetObjectCommand({ Bucket: "saleimages", Key: `saleImages/${key}` });
      return getSignedUrl(s3, command, { expiresIn: 9000 }); // default
    })
  );
  return presignedUrls;
};

const gettAppUser = async (appUser) => {
  AWS.config.update({
    accessKeyId: "AKIAW7EO5CI5BDGH7UNF",
    secretAccessKey: "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",
    region: "us-east-1",
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let data;

  let searchId = {
    TableName: "users",
    FilterExpression: "#email = :email",
    ExpressionAttributeNames: {
      "#email": "email",
    },
    ExpressionAttributeValues: {
      ":email": appUser,
    },
  };

  let activeUser = await dynamodb.scan(searchId).promise();
  if (activeUser && activeUser.Items && activeUser.Items.length > 0) {
    return { status: 200, data: activeUser.Items[0] };
  } else {
    return { status: 500, data: "no user found" };
  }
  // if (activeUser && activeUser.Items && activeUser.Items.length > 0) {
  //   if (activeUser.Items[0].interestItems) {
  //     for (let item of activeUser.Items[0].interestItems) {
  //       console.log(item);
  //     }
  //   }
  // } else {
  // }
};

//getInterestedSaved
const getSavedInterested = async (appUserId) => {
  let appUser = await gettAppUser(appUserId);
  let savedInterestedItems = { interested: [], saved: [] };
  if (appUser.status === 200 && appUser.data) {
    if (checkKey("interested", appUser.data) && appUser.data?.interested) {
      for (let item of appUser.data?.interested) {
        let eachItem = await getListingById(item);
        if (eachItem.status === 200) {
          savedInterestedItems.interested.push(eachItem.data);
        }
      }
    }
    if (checkKey("saved", appUser.data) && appUser.data?.saved) {
      for (let item of appUser.data?.saved) {
        let eachItem = await getListingById(item);
        if (eachItem.status === 200) {
          savedInterestedItems.saved.push(eachItem.data);
        }
      }
    }
    return { status: 200, items: savedInterestedItems };
  } else {
    return { status: 204, items: savedInterestedItems };
  }
};

function checkKey(key, data) {
  if (key in data) {
    return true;
  }
  return false;
}

const interestedItems = async (appUserId, listingId) => {
  let appUser = await gettAppUser(appUserId);
  if (appUser.status === 200 && appUser.data) {
    if (checkKey("interested", appUser.data) && appUser.data.interested) {
      let values = [],
        listingValues = [];
      for (let item of appUser.data?.interested) {
        values.push(item);
      }

      if (values.includes(listingId)) {
        listingValues = values.filter(function (e) {
          return e !== listingId;
        });
      } else {
        listingValues = values.concat(listingId);
      }
      return await putItem(listingValues, "users", appUserId);
    } else {
      return await putItem([listingId], "users", appUserId);
    }
  } else {
    return { status: 204, data: "no user" };
  }
};

const savedItems = async (appUserId, listingId) => {
  let appUser = await gettAppUser(appUserId);
  if (appUser.status === 200 && appUser.data) {
    if (checkKey("saved", appUser.data) && appUser.data.saved) {
      let values = [],
        listingValues = [];
      for (let item of appUser.data?.saved) {
        values.push(item);
      }

      if (values.includes(listingId)) {
        listingValues = values.filter(function (e) {
          return e !== listingId;
        });
      } else {
        listingValues = values.concat(listingId);
      }
      return await putItemSaved(listingValues, "users", appUserId);
    } else {
      return await putItemSaved([listingId], "users", appUserId);
    }
  } else {
    return { status: 204, data: "no user" };
  }
};

const putItem = async (values, tableName, appUserId) => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  let searchId = {
    TableName: tableName,
    Key: {
      email: appUserId,
      //find the itemId in the table that you pull from the event
    },
    UpdateExpression: "set interested= :interested",
    // This expression is what updates the item attribute
    ExpressionAttributeValues: {
      ":interested": values,
      //create an Expression Attribute Value to pass in the expression above
    },
    ReturnValues: "UPDATED_NEW",
  };
  let documents = await dynamodb.update(searchId).promise();
  //console.log(documents);

  if (documents) {
    return { status: 200 };
  } else {
    return { status: 204 };
  }
};

const putItemSaved = async (values, tableName, appUserId) => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  let searchId = {
    TableName: tableName,
    Key: {
      email: appUserId,
      //find the itemId in the table that you pull from the event
    },
    UpdateExpression: "set saved= :saved",
    // This expression is what updates the item attribute
    ExpressionAttributeValues: {
      ":saved": values,
      //create an Expression Attribute Value to pass in the expression above
    },
    ReturnValues: "UPDATED_NEW",
  };
  let documents = await dynamodb.update(searchId).promise();

  if (documents) {
    return { status: 200 };
  } else {
    return { status: 204 };
  }
};

const getItemsForMap = async () => {
  const items = await getItems();
  let response = { status: 200, data: [] };
  for (let item of items.data) {
    response.data.push({
      image: item?.images[0],
      eventStart: item?.eventStart,
      eventEnd: item?.eventEnd,
      listingId: item.listingId,
      title: item.title,
      location: await getLatAndLon(item.address.placeId),
    });
  }
  return response;
};

const getLatAndLon = async (placeId) => {
  try {
    let response = await axios.post(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=AIzaSyDtaONwav4HNhpa-hDwzMwqIL_bQwse-lA`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (response.data) {
      return {
        latitude: response.data.result.geometry.location.lat,
        longitude: response.data.result.geometry.location.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }
  } catch (e) {}
};

module.exports = {
  getItems,
  getListingById,
  getSavedInterested,
  gettAppUser,
  interestedItems,
  savedItems,
  getItemsForMap,
};
