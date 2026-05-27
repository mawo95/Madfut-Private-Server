const admin = require("firebase-admin");
const axios = require("axios");
const Fastify = require("fastify");
const { Rtdb } = require("./rtdb.js")
const serviceAccount = require("./admin.json");


const fastify = Fastify({ logger: false });

const tokenCache = new Map();
const activeBListeners = new Map();
const activeTrades = new Map(); //TODO: implement to stop double listeners

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: ""
});

const db = admin.firestore();
const aDb = admin.database()
const auth = admin.auth();




//Handling invites...
// If someone invites on the private server, the invite gets sent to the original madfut firebase and a bridge is created to sync all updates
//Because we arent madfut admins, we still need a refreshToken for the real madfut db
//The refresh token is set as custom claim on our own firebase project after signUp. 
function listenToOnlineQueue() {
  console.log("Listening to onlineQueue...");
  db.collection("onlineQueue").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      const doc = change.doc;
      const inviterUid = doc.id;
      const data = doc.data(); 
      if (change.type == "added") {
        try {
            const invitedUsername = data.invitedUsername;
  		    console.log("Trade search:", inviterUid);
            
            const user = await admin.auth().getUser(inviterUid);
            const refreshToken = user.customClaims?.refreshToken;
            if (!refreshToken) {
            	console.log("No refreshToken claim found");
            	return;
            }
            const idToken = await getIdToken(refreshToken)
            const decoded = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
			      const realUid = decoded.user_id || decoded.sub;
            
            const patlh = "onlineQueue/"+realUid
            const urlll = "https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/"+patlh
          	await axios.delete(urlll, {headers: { "Authorization": `Bearer ${idToken}` }});
            
            const dbB = new Rtdb("https://trivela-madfut-online.europe-west1.firebasedatabase.app", false);
			      await dbB.init();
  			    await dbB.login(idToken);

            const realDoc = (await axios.get(`https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/users/${realUid}`, { headers: { Authorization: `Bearer ${idToken}` }})).data.fields
            const realUsername = realDoc.username.stringValue
            const realNation = realDoc.badgeName.stringValue
             
            const url = `https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents:commit`;
    		    const docName = `projects/trivela-madfut/databases/(default)/documents/onlineQueue/${realUid}`;
    		    const body = {writes: [{update: {name: docName,fields: {
                        requestId: { stringValue: data.requestId},
                        username: { stringValue: realUsername },
                        compatibilityId: { stringValue: "a" },
                        invitedUsername: { stringValue: invitedUsername },
                        mode: { stringValue: "trading" },
                        badgeName: { stringValue: realNation },
                        node: { stringValue: "" }
                    }}},{transform: {document: docName,fieldTransforms: [{ fieldPath: "timestamp", setToServerValue: "REQUEST_TIME" }]}}]};
       		await axios.post(url, body, {headers: { Authorization: `Bearer ${idToken}` }}) 
            
            if (activeBListeners.has(inviterUid)) return;
            const interval = setInterval(async () => {
                try {
    				const res = await axios.get(`https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/onlineQueue/${realUid}`,
					{ headers: { Authorization: `Bearer ${idToken}` }, validateStatus: () => true });
    				if (res.status !== 200) return;
    				const fields = res.data.fields;
					if (fields?.roomId) {
      					const roomId = fields.roomId.stringValue;
      					const isHost = fields.isHost.booleanValue;
      					const opponentUsername = fields.opponentUsername.stringValue;
      					console.log("Match gefunden in B:", roomId);
      					await db.collection("onlineQueue").doc(inviterUid).update({
        					roomId,
        					isHost,
        					opponentUsername
      					});
      					clearInterval(interval);
      					activeBListeners.delete(inviterUid);
        				await createTradeBridge(idToken,realUid, roomId, isHost, dbB, aDb, data.username, data.badgeName, data.requestId, inviterUid);
    				}
  				} catch (err) {
    				console.log("B Listener error:", err.message);
  				}
			}, 200);
            const listenerObj = {listener:interval,db:dbB}
			activeBListeners.set(inviterUid, listenerObj);
            
        }catch(err){
            console.log("Error in random trading... " + err)
        }
          
      
          
  	  }else if (change.type == "removed") {
		try { 
            const user = await admin.auth().getUser(inviterUid);
            const refreshToken = user.customClaims?.refreshToken;
            if (!refreshToken) {
            	console.log("No refreshToken claim found");
            	return;
            }
            const idToken = await getIdToken(refreshToken)
            const decoded = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
			const realUid = decoded.user_id || decoded.sub;
            const listener = activeBListeners.get(inviterUid);
            if (listener) {
  				clearInterval(listener.listener);
                const deleteDb = listener.db
                await deleteDb.logout()
  				activeBListeners.delete(inviterUid);
			}
            const path = "onlineQueue/"+realUid
            const url = "https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/"+path
            await axios.delete(url, {headers: { "Authorization": `Bearer ${idToken}` }});
		} catch (err) {
          console.error("Delete Fehler:", err);
        }
      }
    });
  });
}



//some painful syncing (i am surprised it worked out with all the listeners but i think i cleanup everything)
async function createTradeBridge(idToken, uid, tradeId, isHost,dbB, rtdbA, username, nation, requestId,inviterUid) {
  console.log("Starting RTDB bridge:", tradeId);

  const mySide = isHost ? "H" : "G";
  const myProfile = isHost ? "h" : "g";
  const enemySide = isHost ? "G" : "H";
  const enemyProfile = isHost ? "g" : "h";

  let stopped = false;

  const stop = async (source) => {
    if (stopped) return;
    stopped = true;
    console.log("Stopping bridge from:", source, tradeId);
    try {
      refA1.off("value", fnA1); //action
      refA2.off("value", fnA2); //profile
      tradeRef.off("value", endListener); //end

      dbB.off(cbB0) // i
      dbB.off(cbB1); //action
      dbB.off(cbB2); //profile
      dbB.off(cbBAll); //end

      await dbB.logout();
    } catch (e) {
      console.log("Stop error:", e.message);
    }
  };

    
    
  const refA1 = rtdbA.ref(`r/${tradeId}/${mySide}`);
  const refA2 = rtdbA.ref(`r/${tradeId}/${myProfile}`);
    
  const fnA1 = refA1.on("value", async (snap) => { //TODO try onChildAdded or changed
    const data = snap.val();
    if (!data || stopped) return;
      //console.log("MOD ACTION TO B: " + JSON.stringify(data))
	await dbB.setData(`r/${tradeId}/${mySide}`, data);
  });

  const fnA2 = refA2.on("value", async (snap) => { //TODO try onChildAdded or changed
    const data = snap.val();
    if (!data || stopped) return;
	//console.log("MOD PROFILE TO B: " + JSON.stringify(data))
    await dbB.setData(`r/${tradeId}/${myProfile}`, data);
  });
    
    

   const cbB0 = dbB.onValue("r/"+tradeId+"/i", async (snap)=>{
       const data = snap.val()
       if(data != null){
           
           if(mySide == "G"){
           	   data.b2 = nation
               data.n2 = username
               data.r2 = requestId
               data.u2 = inviterUid
           }else{
               data.b1 = nation
               data.n1 = username
               data.r1 = requestId
               data.u1 = inviterUid
           }
           await rtdbA.ref("r/"+tradeId+"/i").set(data)
           dbB.off(cbB0)
       }
   })
    
  const cbB1 = dbB.onValue(`r/${tradeId}/${enemySide}`, async (snap) => {
    const data = snap.val();
    if (!data || stopped) return;
	//console.log("REAL ACTION TO MOD: " + JSON.stringify(data))
    await rtdbA.ref(`r/${tradeId}/${enemySide}`).set(data);
  });

  const cbB2 = dbB.onValue(`r/${tradeId}/${enemyProfile}`, async (snap) => {
    const data = snap.val();
    if (!data || stopped) return;
	//console.log("REAL PROFILE TO MOD: " + JSON.stringify(data))
    await rtdbA.ref(`r/${tradeId}/${enemyProfile}`).set(data);
  });

    
  const cbBAll = dbB.onValue(`r/${tradeId}`, async (snap) => {
      console.log("Real:")
      console.log(snap.val())
      if (snap.val() === null) {
      //console.log("Trade ended from B (geforced)");
        await rtdbA.ref(`r/${tradeId}`).set(null);
        //await stop("MADFUT");
      }
  });
    
  const tradeRef = rtdbA.ref(`r/${tradeId}`);
  const endListener = tradeRef.on("value", async (snap) => {
    console.log(snap.val())
    if (snap.val() == null) {
      //console.log("Trade ended from MOD (geforced)");
      await dbB.setData(`r/${tradeId}`, null);
      await stop("");
    }
  });
    
}








//profile listening
function listenToQueue() {
  console.log("Listening to usernamesQueue...");
  db.collection("usernamesQueue").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const doc = change.doc;
        const uid = doc.id;
        const data = doc.data();
        console.log(`Neuer Queue-Eintrag: ${uid}`, data);
        try {
          if (!isValidUsername(data.username)) {
            console.log(`Ungültiger Username für ${uid}:`, data.username);
            return;
          }
          const userRecord = await auth.getUser(uid);
          let providerId = null;
          if (userRecord.providerData && userRecord.providerData.length > 0) {
            providerId = userRecord.providerData[0].providerId;
          }
          const username = data.username.toLowerCase();
          await db.collection("users").doc(uid).create({
            requestId: data.requestId || null,
            timeCreated: admin.firestore.FieldValue.serverTimestamp(),
              badgeName: data.badgeName || "nation_badge_21",
              nationId:data.nationId || 21,
              username:username,
              banned:false,
              mooderator:false,
              providerId,
              response:"Success",
              providerId: providerId
          });
            await db.collection("usernames").doc(username).set({
 				uid: uid
			});
            await doc.ref.delete();
        } catch (err) {
            if (err.code === 6 || err.code === "already-exists") {
    			console.log("User existiert schon → alles gut:", uid);
                await doc.ref.delete();
  			} else {
          		console.error("Fehler beim Erstellen:", err);
  			}
        }
      }
    });
  });
}




















//standard methode
async function getIdToken(refreshToken) {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expires > Date.now()) {
    return cached.idToken;
  }
  const res = await axios.post(
    `https://securetoken.googleapis.com/v1/token?key=AIzaSyALwUkCX8S0aI6nmWGjdjKJqgqbN9O25c8`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const idToken = res.data.id_token;
  tokenCache.set(refreshToken, {
    idToken,
    expires: Date.now() + 55 * 60 * 1000
  });
  return idToken;
}

function isValidUsername(username) {
  if (typeof username !== "string") return false;
  const regex = /^[a-zA-Z0-9]{4,12}$/;
  return regex.test(username);
}





fastify.get("/",async (req,rep)  => {
    return ""
})

//mark a user as vip to later allow trading
fastify.post("/adminClaims",async (req,rep)=> {
    //email:email refreshToken:refreshToken
    const user = await admin.auth().getUserByEmail(req.body.email).catch(() => null);
    if (!user) {
      return "No user with email found";
    }
    await admin.auth().setCustomUserClaims(user.uid, {
      ...user.customClaims,
      isVip: true,
      refreshToken:req.body.refreshToken
    });
     await admin.auth().revokeRefreshTokens(user.uid);
    return "ok"
})



//painful transformations... it took hours to fit it for every possible values
function firestoreValueToJs(field) {
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;

  if (field.timestampValue !== undefined) {
    return new Date(field.timestampValue);
  }

  if (field.arrayValue) {
    return (field.arrayValue.values || []).map(firestoreValueToJs);
  }

  if (field.mapValue) {
    const obj = {};

    for (const key in field.mapValue.fields || {}) {
      obj[key] = firestoreValueToJs(field.mapValue.fields[key]);
    }

    return obj;
  }

  return field;
}


// Function to copy firestore docs like /config, /draftoftheday and objectives easily into our own firebase
async function importFirestore(url) {
  try {
    const { data } = await axios.get(url);
    const documents = data.documents ? data.documents : [data];

    if (!documents.length) {
      console.log("No documents found.");
      return;
    }

    for (const doc of documents) {
      const fullPath = doc.name.split("/documents/")[1];

      const parts = fullPath.split("/");

      const docId = parts.pop();
      const collectionPath = parts.join("/");

      const parsedData = {};

      for (const key in doc.fields || {}) {
        parsedData[key] = firestoreValueToJs(doc.fields[key]);
      }

      await db
        .collection(collectionPath)
        .doc(docId)
        .set(parsedData);

      console.log(`Imported: ${collectionPath}/${docId}`);
    }

    console.log("Import complete.");
  } catch (err) {
    console.error(
      "Import failed:",
      err.response?.data || err.message
    );
  }
}

//eexamples
//importFirestore(
//  "https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/sbcGroups"
//);

//importFirestore(
 // "https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/configs/385"
//);


//making it an endpoint
fastify.post("/updateUrl", async (req,rep)=>{
    const url = req.body.url
    if(url.startsWith("https")){
        return "gib nur den path an, also likesDislikes/allLikesDislikes oder sowas"
    }else{
    importFirestore("https://firestore.googleapis.com/v1/projects/trivela-madfut/databases/(default)/documents/"+url);
    return url
    }
    
    })


//setting custom claims by email
fastify.post("/giveUserVip", async (request, reply) => {
  try {
    const { refreshToken } = request.body;
      const res = await axios.post(
    `https://securetoken.googleapis.com/v1/token?key=AIzaSyALwUkCX8S0aI6nmWGjdjKJqgqbN9O25c8`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
      
       const decoded = JSON.parse(Buffer.from(res.data.id_token.split('.')[1], 'base64').toString());
	   const realUid = decoded.user_id || decoded.sub;
       const email = decoded.email
  
    const user = await admin.auth().getUserByEmail(email).catch(() => null);
    if (!user) {
      return "No user with email found";
    }
    if (user.customClaims?.isVip === true) {
      return "Already vip";
    }
    await admin.auth().setCustomUserClaims(user.uid, {
      ...user.customClaims,
      isVip: true,
        refreshToken:refreshToken
    });
     await admin.auth().revokeRefreshTokens(user.uid);
    return "ok-"+email;
  } catch (error) {
      if(error.reason == "Request failed with status code 400" || error.message == "Request failed with status code 400"){
          return "Invalid Refresh-Token"
      }else{
    return "Error " + (error.reason || error.message || "Unknown");
      }
  }
});

const start = async () => {
    await fastify.listen({port: 10000,host: "0.0.0.0"});
    console.log("Listening for new vips...");
};



listenToQueue();
listenToOnlineQueue();
start();
