const AWS = require("aws-sdk");
const { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const axios = require("axios");
const {
  v1: uuidv1,
  v4: uuidv4,
} = require('uuid');

const getUserItems = async (userId) => {
  if (userId) {
    try {
      const appUser = await gettAppUser(userId);
      if (appUser && appUser.data && appUser.data.userPreference) {
        let address = appUser.data.userPreference?.address;
        if (address.latitude && address.longitude) {
          const filteredData = await filterItems({
            address: {
              latitude: address.latitude,
              longitude: address.longitude
            }, range: appUser.data.userPreference?.range
          })
          if (filteredData) {
            return { status: 200, data: filteredData };
          }
        } else {
          return { status: 204, data: [] };
        }
      } else {
        return await getItems();
      }
    } catch (e) {
      return { status: 500, data: 'SOMETHING_WRONG' };
    }
  } else {
    return { status: 401, data: 'INVALID_SESSION' };
  }
}
const getItems = async (userId) => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  let searchId = {
    TableName: process.env.SALEDATA,
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
    TableName: process.env.SALEDATA,
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
      const conversation = await getConversationsByListingId(listingId);
      if (conversation.status === 200 || 204) {
        documents.Items[0].conversation = conversation.data;
      }
    } catch (err) {
      return { status: 500, error: err?.message };
    }
    return { status: 200, data: documents.Items[0] };
  } else {
    return { status: 204, data: [] };
  }
};

const getConversationsByListingId = async (listingId) => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let searchId = {
    TableName: process.env.CONVERSATION,
    FilterExpression: "#listingId = :listingId",
    ExpressionAttributeNames: {
      "#listingId": "listingId",
    },
    ExpressionAttributeValues: {
      ":listingId": listingId,
    },
  };

  try {
    const documents = await dynamodb.scan(searchId).promise();
    if (documents.Items.length > 0) {
      return { status: 200, data: documents.Items };
    }
    return { status: 200, data: [] };
  } catch (e) {
    return { status: 500, data: 'error getting conversations' };
  }
}

const getChatsByUserId = async (userId) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let searchId = {
    TableName: process.env.CONVERSATION,
    FilterExpression: "#itemOwner = :itemOwner OR #oppChatUser = :oppChatUser",
    ExpressionAttributeNames: {
      "#itemOwner": "itemOwner",
      "#oppChatUser": "oppChatUser"
    },
    ExpressionAttributeValues: {
      ":itemOwner": userId,
      ":oppChatUser": userId
    }

  };
  try {
    let documents = await dynamodb.scan(searchId).promise();
    if (documents.Items.length > 0) {
      for (let i = 0; i < documents.Items.length; i++) {
        let last_Message = await getMessageById(documents.Items[i]?.lastMessage);
        let chatDisplayName;
        const oppChatUserId = documents.Items[i]?.oppChatUser === userId;
        if (oppChatUserId) {
          chatDisplayName = await gettAppUser(documents.Items[i]?.itemOwner);
        } else {
          chatDisplayName = await gettAppUser(documents.Items[i]?.oppChatUser);
        }
        // if (documents.Items[i]?.oppChatUser === userId) {
        //   chatDisplayName = await gettAppUser(documents.Items[i].itemOwner);
        // } else {
        //   chatDisplayName = await gettAppUser(documents.Items[i]?.oppChatUser);
        // }
        if (last_Message.status === 200) {
          documents.Items[i].lastMessageContent = last_Message;
          documents.Items[i].lastMessageTime = last_Message.data && last_Message.data[0].timeStamp;
          documents.Items[i].chatUserName = chatDisplayName && chatDisplayName.data && chatDisplayName.data.name
        }
      }
      documents.Items.sort((a, b) => {
        return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
      })
      return { status: 200, data: documents.Items };
    } else {
      return { status: 204, data: [] };
    }
  }
  catch (e) {
    return { status: 500, data: [] };
  }
};

const getMessageById = async (messageId) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let searchId = {
    TableName: process.env.MESSAGES,
    FilterExpression: "#message_Id = :message_Id",
    ExpressionAttributeNames: {
      "#message_Id": "message_Id",
    },
    ExpressionAttributeValues: {
      ":message_Id": messageId,
    },

  };
  try {
    let documents = await dynamodb.scan(searchId).promise();
    if (documents.Items.length > 0) {
      return { status: 200, data: documents.Items };
    } else {
      return { status: 204, data: [] };
    }
  }
  catch (e) {
    return { status: 500, data: [] };
  }
}

//get presigned urls for the images
const generatePreSignedUrlsForImages = async (images = []) => {
  const s3 = new S3Client({
    region: process.env.REGION,
    credentials: {
      accessKeyId: process.env.ACCESS_KEY_ID,
      secretAccessKey: process.env.SECRET_ACCESS_KEY,
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

const getUsersMessages = async (conversationId) => {
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  let items = []
  try {
    let itemsToSearch = {
      TableName: process.env.MESSAGES,
      FilterExpression: "#conversation_Id = :conversation_Id",
      ExpressionAttributeNames: {
        "#conversation_Id": "conversation_Id",
      },
      ExpressionAttributeValues: {
        ":conversation_Id": conversationId,
      },
    };

    const convos = await dynamodb.scan(itemsToSearch).promise();

    if (convos.Items.length > 0) {
      convos.Items.forEach(Item => {
        items.push({
          _id: Item.message_Id,
          createdAt: Item.timeStamp,
          user: {
            _id: Item.sender_UserId
          },
          text: Item.context
        })
      })
      return { data: items, status: 200 }
    } else {
      return { data: items, status: 204 }
    }
  } catch (e) {
    return { data: 'error', status: 204 }
  }

}

const verifyUser = async (formData) => {

  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  let searchId = {
    TableName: process.env.USERS,
    Key: {
      email: formData.email,
      //find the itemId in the table that you pull from the event
    },
    UpdateExpression: "set verified= :verified",
    // This expression is what updates the item attribute
    ExpressionAttributeValues: {
      ":verified": true,
      //create an Expression Attribute Value to pass in the expression above
    },
    ReturnValues: "UPDATED_NEW",
  };
  let documents = await dynamodb.update(searchId).promise();

  if (documents) {
    return { status: 200, data: "Success" };
  } else {
    return { status: 204, data: "failed" };
  }

}

const gettAppUser = async (appUser) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

  let data;

  let searchId = {
    TableName: process.env.USERS,
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
};

//getInterestedSaved
const getSavedInterested = async (appUserId) => {
  try {
    let appUser = await gettAppUser(appUserId);
    let savedInterestedItems = [];
    if (appUser.status === 200 && appUser.data) {
      if (checkKey("interested", appUser.data) && appUser.data?.interested) {
        for (let item of appUser.data?.interested) {
          let eachItem = await getListingById(item);
          if (eachItem.status === 200) {
            savedInterestedItems.push(eachItem.data);
          }
        }
      }
      appUser = await gettAppUser(appUserId);
      return { status: 200, items: savedInterestedItems };
    } else {
      return { status: 204, items: savedInterestedItems };
    }
  } catch (e) {
    return { status: 500, data: "something went wrong" };
  }
};

function checkKey(key, data) {
  if (key in data) {
    return true;
  }
  return false;
}

const interestedItems = async (appUserId, listingId) => {
  try {
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
        return await putItem(listingValues, process.env.USERS, appUserId);
      } else {
        return await putItem([listingId], process.env.USERS, appUserId);
      }
    } else {
      return { status: 204, data: "no user" };
    }
  } catch (e) {
    return { status: 500, data: "no user" };
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
      return await putItemSaved(listingValues, process.env.USERS, appUserId);
    } else {
      return await putItemSaved([listingId], process.env.USERS, appUserId);
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

  if (documents) {
    return { status: 200, data: "Success" };
  } else {
    return { status: 204, data: "failed" };
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
      location: await getLatAndLon(item.placeId),
    });
  }
  return response;
};

const getLatAndLon = async (placeId) => {
  try {
    const response = await axios.post(
      `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeId}&key=${process.env.MAPS_KEY}`
    );
    if (response.data) {
      return {
        latitude: response.data.result.geometry.location.lat,
        longitude: response.data.result.geometry.location.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
    }
  } catch (e) { return null }
};


const saveChatMessages = async (sender, receiver, message, conversationId) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: "us-east-1",
  });
  try {
    let messageData = {
      sender_UserId: sender,
      context: message,
      conversation_Id: conversationId,
      message_Id: uuidv4(),
      timeStamp: Date.now()
    }
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
    let convUUID;

    if (conversationId !== undefined) {
      let searchId = {
        TableName: process.env.CONVERSATION,
        Key: {
          conversation_Id: conversationId,
          //find the itemId in the table that you pull from the event
        },
        UpdateExpression: "set lastMessage= :lastMessage",
        // This expression is what updates the item attribute
        ExpressionAttributeValues: {
          ":lastMessage": messageData.message_Id,
          //create an Expression Attribute Value to pass in the expression above
        },
        ReturnValues: "UPDATED_NEW",
      };
      let documents = await dynamodb.update(searchId).promise();

    } else {

      convUUID = uuidv4()
      messageData.conversation_Id = convUUID;
      let convDats = {
        conversation_Id: convUUID,
        lastMessage: messageData.message_Id,
        itemOwner: receiver,
        oppChatUser: sender
      }
      const conParams = {
        TableName: process.env.CONVERSATION,
        Item: convDats,
      };
      await dynamodb
        .put(conParams)
        .promise()
        .then((data) => { })
        .catch((err) => { });
    }
    const params = {
      TableName: process.env.MESSAGES,
      Item: messageData,
    };

    await dynamodb
      .put(params)
      .promise()
      .then((data) => { })
      .catch((err) => { });
    return convUUID;

  } catch (e) { }
};

const createConversationIdForUserChats = async (sender, receiver, message_Id, listingId) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  try {
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
    const convUUID = uuidv4();
    const conversationData = {
      conversation_Id: convUUID,
      lastMessage: message_Id,
      itemOwner: receiver,
      oppChatUser: sender,
      listingId: listingId
    }
    const conParams = {
      TableName: process.env.CONVERSATION,
      Item: conversationData,
    };
    return await dynamodb
      .put(conParams)
      .promise()
      .then((data) => { return { status: 200, conversationId: convUUID } })
      .catch((err) => { return { status: 500, data: 'error creating conversation id' } });
  } catch (e) {
    return { status: 500, data: 'error creating conversation id' };
  }

}

const saveConversationLastMessage = async (conversation_Id, message_Id) => {
  try {
    AWS.config.update({
      accessKeyId: process.env.ACCESS_KEY_ID,
      secretAccessKey: process.env.SECRET_ACCESS_KEY,
      region: process.env.REGION,
    });
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });

    let updateConversationChat = {
      TableName: process.env.CONVERSATION,
      Key: {
        conversation_Id: conversation_Id,
        //find the itemId in the table that you pull from the event
      },
      UpdateExpression: "set lastMessage= :lastMessage",
      // This expression is what updates the item attribute
      ExpressionAttributeValues: {
        ":lastMessage": message_Id,
        //create an Expression Attribute Value to pass in the expression above
      },
      ReturnValues: "UPDATED_NEW",
    };
    await dynamodb.update(updateConversationChat).promise();
  } catch (e) {
    return { status: 500, data: 'error saving conversationId' };
  }
}

const saveUserChatMessages = async (sender, message_Id, context, conversation_Id) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  try {
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
    await saveConversationLastMessage(conversation_Id, message_Id);
    const messageData = {
      sender_UserId: sender,
      context: context,
      conversation_Id: conversation_Id,
      message_Id: message_Id,
      timeStamp: Date.now()
    }
    const params = {
      TableName: process.env.MESSAGES,
      Item: messageData,
    };
    await dynamodb
      .put(params)
      .promise()
      .then((data) => { })
      .catch((err) => { console.log(err); });
  } catch (e) {
    return { status: 500, data: 'error creating conversation id' };
  }
}

const filterData = async (data) => {
  AWS.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
    region: process.env.REGION,
  });
  const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
  try {
    let searchId = {
      TableName: process.env.SALEDATA, // Replace with your DynamoDB table name
      FilterExpression: [
        data.bath ? 'bath = :bath' : '',
        data.beds ? 'beds = :beds' : '',
        data.houseType ? 'houseType = :houseType' : '',
        data.parkingType ? 'parkingType = :parkingType' : '',
        data.price ? 'price <= :price' : ''].filter(expression => expression.indexOf(':') !== -1).join(' AND '),
      ExpressionAttributeValues: {
        ':bath': String(data.bath),
        ':beds': String(data.beds),
        ':price': String(data.price),
        ':houseType': String(data.houseType),
        ':parkingType': String(data.parkingType),
      },
    };

    !data.beds ? delete searchId.ExpressionAttributeValues[':beds'] : null;
    !data.bath ? delete searchId.ExpressionAttributeValues[':bath'] : null;
    !data.price ? delete searchId.ExpressionAttributeValues[':price'] : null;
    !data.houseType ? delete searchId.ExpressionAttributeValues[':houseType'] : null;
    !data.parkingType ? delete searchId.ExpressionAttributeValues[':parkingType'] : null;

    console.log(searchId);


    const responseData = await dynamodb.scan(searchId).promise();
    if (responseData) {
      await responseData.Items.forEach(async (item) => {
        let images = await generatePreSignedUrlsForImages(item.images);
        item.images = images;
      })
      return { status: 200, data: responseData.Items }
    } else {
      return { status: 500, data: 'no items found' }
    }
  } catch (e) {
    console.log(e);
    return { status: 500, data: 'something went wrong' }
  }
}

const filterDataWithUserPreference = async (userId, data) => {
  if (userId) {
    if (data && (data.beds || data.bath || data.houseType || data.parkingType || data.price)) {
      let responseItems = await filterData(data);

      if (responseItems.status === 200) {
        const appUser = await gettAppUser(userId);
        let address,
          itemsData = [];
        if (appUser && appUser.data && appUser.data.userPreference) {
          address = appUser.data.userPreference?.address;

          await responseItems.data.forEach(async (item, index) => {
            const disance = await calculateDistance({
              latitude: item.address.latitude,
              longitude: item.address.longitude
            }, {
              address: {
                latitude: address.latitude,
                longitude: address.longitude
              }, range: appUser.data.userPreference?.range
            })
            if (disance < appUser.data.userPreference?.range) {


              itemsData.push(item);
            }
          })
        }

        // await itemsData?.forEach(async (item) => {
        //   const imgs = await generatePreSignedUrlsForImages(item.images);
        //   item.images = imgs;
        //   console.log(imgs);
        // })
        console.log(itemsData, "&&&&&&-----");
        return { status: 200, data: itemsData };
      } else {
        return { status: 500, data: 'something went wrong' }
      }
    } else {
      return await getUserItems(userId);
    }
  } else {
    return { status: 401, data: 'INVALID_SESSION' };
  }
}

const updateUserPreferenceAndSortData = async (userId, data) => {

  if (data) {
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
    let searchId = {
      TableName: process.env.USERS,
      Key: {
        email: userId,
        //find the itemId in the table that you pull from the event
      },
      UpdateExpression: "set userPreference= :userPreference",
      // This expression is what updates the item attribute
      ExpressionAttributeValues: {
        ":userPreference": data,
        //create an Expression Attribute Value to pass in the expression above
      },
      ReturnValues: "UPDATED_NEW",
    };
    await dynamodb.update(searchId).promise();
    const filteredData = await getUserItems(userId);
    if (filteredData) {
      return filteredData;
    }
  } else {
    return { status: 500 };
  }
}

const updateUserNotifications = async (userId, data) => {
  if (data) {
    const dynamodb = new AWS.DynamoDB.DocumentClient({ apiVersion: "2012-08-10" });
    let searchId = {
      TableName: process.env.USERS,
      Key: {
        email: userId,
        //find the itemId in the table that you pull from the event
      },
      UpdateExpression: "set notifications= :notifications",
      // This expression is what updates the item attribute
      ExpressionAttributeValues: {
        ":notifications": data,
        //create an Expression Attribute Value to pass in the expression above
      },
      ReturnValues: "UPDATED_NEW",
    };
    await dynamodb.update(searchId).promise();
    const filteredData = await gettAppUser(userId);
    if (filteredData) {
      return filteredData;
    }
  } else {
    return { status: 500 };
  }
}



const filterItems = async (origin) => {
  const items = await getItems();
  let filterItem = [];
  if (items && items.data && items.data.length > 0) {
    for (let item of items.data) {
      let distance;
      if (item.address && item.address.latitude && item.address.longitude) {
        distance = await calculateDistance({
          latitude: item.address.latitude,
          longitude: item.address.longitude
        }, origin);
      }
      if (distance <= origin.range) {
        filterItem.push(item);
      }
    }
  }
  return filterItem;
}

const calculateDistance = async (destination, origin) => {

  if (destination && origin) {
    const lat1 = origin.address && origin.address.latitude;
    const lon1 = origin.address && origin.address.longitude;
    const lon2 = destination.longitude;
    const lat2 = destination.latitude;
    const earthRadiusKm = 6371;

    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = earthRadiusKm * c; // Distance in kilometers

    return distance;
  } else {
    return null;
  }
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

const sendPushNotifications = async (receiver, messagedata) => {
  if (receiver && messagedata) {
    const receiverInfo = await gettAppUser(receiver);
    if (receiverInfo.status === 200 &&
      receiverInfo.data &&
      receiverInfo.data?.notifications &&
      receiverInfo.data?.notifications?.phoneNotifications &&
      receiverInfo.data?.notifications?.appNotifications &&
      receiverInfo.data?.notifications?.token) {
      console.log("****TTT");
      const message = {
        to: receiverInfo.data?.notifications?.token,
        sound: 'default',
        title: receiverInfo.data ? receiverInfo.data?.name : 'Notification',
        body: messagedata ? messagedata : 'Sent you a message',
        data: { someData: 'goes here' },
        screen: 'Chats'
      };

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }).then(data => {
        console.log(data);
      })
    }
  }
}

module.exports = {
  getItems,
  verifyUser,
  getUserItems,
  getListingById,
  getSavedInterested,
  gettAppUser,
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
  createConversationIdForUserChats
};
