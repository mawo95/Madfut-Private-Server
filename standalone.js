const admin = require("firebase-admin");

const serviceAccount = require("./admin.json");
const randomQueue = new Map();

// Lets you test trading by sending an invite or putting a bot in random trading.
const bot = false
const rtBot = false


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: ""
});

const db = admin.firestore();
const auth = admin.auth();


// original madfut usernam check
function isValidUsername(username) {
  if (typeof username !== "string") return false;

  const regex = /^[a-zA-Z0-9]{4,12}$/;
  return regex.test(username);
}

// original roomId generation
function generateRoomId() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '-';
  for (let i = 0; i < 25; i++) {
    const randomIndex = Math.floor(Math.random() * letters.length);
    result += letters[randomIndex];
  }
  return result;
}

// update profile (gets triggered after signUp)
function listenToQueue() {
  console.log("Listening to usernamesQueue...");

  db.collection("usernamesQueue").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const doc = change.doc;
        const uid = doc.id;
        const data = doc.data();

        console.log(`New Queue-entry: ${uid}`, data);
     
        try {
          if (!isValidUsername(data.username)) {
            console.log(`invalid Username for ${uid}:`, data.username);
            return;
          }
            
          const userRecord = await auth.getUser(uid);
          let providerId = null;

          if (userRecord.providerData && userRecord.providerData.length > 0) {
            providerId = userRecord.providerData[0].providerId;
          }
            
          const username = data.username.toLowerCase(); // lowercase is very important

          //create the users document. I added a custom field isVip.
          await db.collection("users").doc(uid).create({
            requestId: data.requestId || null,
            timeCreated: admin.firestore.FieldValue.serverTimestamp(),
              badgeName: data.badgeName || "nation_badge_21",
              nationId:data.nationId || 21,
              username:username,
              banned:false,
              moderator:false,
              isVip:false,
              providerId,
              response:"Success",
              providerId: providerId
          });

          //this is an internal document (read and write permissions in firebase rules are false), which will make usernames to uid lookups easier.
          //The above reason was the reason madfut had this document back then and now they also use read,write: false
          await db.collection("usernames").doc(username).set({
            uid: uid
          });

          console.log(`User-document created for UID: ${uid}`);
          await doc.ref.delete();
          console.log("UsernamesQueue deleted")
        } catch (err) {
            if (err.code === 6 || err.code === "already-exists") {
              console.log("User exists  → all good:", uid);
                 await doc.ref.delete();
            } else {
              console.error("error creating:", err);
            }
        }
      }
    });
  });
}

//onlineQueue to onlineInvites
//some overcomplicated logic but original madfut copied
function listenToOnlineQueue() {
  console.log("Listening to onlineQueue...");

  db.collection("onlineQueue").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      const doc = change.doc;
      const inviterUid = doc.id;
      const data = doc.data();

      if (change.type === "added") {
        try {
          const invitedUsername = data.invitedUsername;
          if (!invitedUsername) {
            console.log("Random trading:", inviterUid);

            // check if you want to trade with the bot to test
            if (inviterUid == "theDevsUid" && rtBot == true) {
                const roomId = generateRoomId();
                const botUsername = "hallo";
                try {
                  await db.collection("onlineQueue").doc(inviterUid).update({
                    roomId,
                    isHost: true,
                    opponentUsername: botUsername
                  });
                  console.log("Random bot match for:", inviterUid);

                  await admin.database().ref(`r/${roomId}`).update({
                    g: { f: "", g: "", j: "", k: "" },
                    G: { x: "b" }
                  });

                } catch (err) {
                  console.error("Bot Match Fehler:", err);
                }
            return;
          }
             
          randomQueue.set(inviterUid, data);
          const available = [...randomQueue.keys()].filter(uid => uid !== inviterUid);

          if (available.length === 0) return;

          const opponentUid = available[0];
          const opponentData = randomQueue.get(opponentUid);


          const roomId = generateRoomId();

          await db.collection("onlineQueue").doc(inviterUid).update({
            roomId,
            isHost: true,
            opponentUsername: opponentData.username
          });

          await db.collection("onlineQueue").doc(opponentUid).update({
            roomId,
            isHost: false,
            opponentUsername: data.username
          });

          console.log("Random match:", inviterUid, "vs", opponentUid);

          randomQueue.delete(inviterUid);
          randomQueue.delete(opponentUid);

          return;
        }

            

        const usernameDoc = await db.collection("usernames").doc(invitedUsername).get(); 

        if (!usernameDoc.exists) {
          console.log("Username doesnt exist:", invitedUsername);
          return;
        }

        const invitedUid = usernameDoc.data().uid;

        await doc.ref.update({ invitedUid });
        await db
            .collection("onlineInvites")
            .doc(invitedUid)
            .collection("invites")
            .doc(inviterUid)
            .set({
              badgeName: data.badgeName,
              compatibilityId: data.compatibilityId,
              mode: data.mode,
              requestId: data.requestId,
              username: data.username,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("Invite created:", inviterUid, "→", invitedUid);

          //check bot for testing
            if(bot == true){
            if(invitedUid == "12345"){
            setTimeout(async function(){
                await db.collection("onlineInvites").doc(invitedUid).collection("invites").doc(inviterUid).update({
                    acceptedUsername:"hallo",
                    acceptedRequestId:data.requestId,
                    acceptedBadgeName:"nation_badge_21"
                })
                
            },1)
            }
            }

        } catch (err) {
          console.error("Invite Fehler:", err);
        }
      }

      // cancel invites
      if (change.type === "removed") {
        try {
          const invitedUid = data.invitedUid;
         
          if (!invitedUid) return;
            try{
             randomQueue.delete(inviterUid);
            }catch{}

          await db
            .collection("onlineInvites")
            .doc(invitedUid)
            .collection("invites")
            .doc(inviterUid)
            .delete();

          console.log("Invite removed (aborted):", inviterUid);

        } catch (err) {
          console.error("Delete Fehler:", err);
        }
      }
    });
  });
}


// accept invite listener
//borcasting the accept to the inviter
function listenToInviteAccept() {
  console.log("Listening to invite accepts...");

  db.collectionGroup("invites").onSnapshot((snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "modified") {
        const doc = change.doc;
        const data = doc.data();

        if (!data.acceptedUsername) return;

        try {
          const inviterUid = doc.id;
          const invitedUid = doc.ref.parent.parent.id;

          console.log("Invite accepted:", inviterUid, invitedUid);
         
            //Bot setup:
            if(data.acceptedUsername == "hallo" && bot == true){
                //Let a bot do the actions lol, hello/12345 is not host
                const roomId = "-NotAnIdLol"
                const isHost = true
                const opponentUsername = data.acceptedUsername
                
                await db.collection("onlineQueue").doc(inviterUid).update({roomId:roomId,isHost:isHost,opponentUsername:opponentUsername}) //give the app the data

                await admin.database().ref("r/-NotAnIdLol").update({
  					g: { f: "", g: "", j: "", k: "" },
 					G: { x: "b" }
				});

                
            }else{
              //normal player flow
                const roomId = generateRoomId()
                const isHost = true
                const opponentUsername = data.acceptedUsername
                
                await db.collection("onlineQueue").doc(inviterUid).update({roomId:roomId,isHost:isHost,opponentUsername:opponentUsername})
                const isHost2 = isHost == false
                await db.collection("onlineQueue").doc(invitedUid).update({roomId:roomId,isHost:isHost2,opponentUsername:data.username})
                
                console.log(data.username + " and " + data.acceptedUsername + " in trade now")
       
            }
        } catch (err) {
          console.error("Accept Fehler:", err);
        }
      }
    });
  });
}



function startAll() {
  listenToQueue();
  listenToOnlineQueue();
  listenToInviteAccept();
}

startAll();
