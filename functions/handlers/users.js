const { admin, db } = require("../util/admin");

const firebaseConfig = require("../util/firebaseConfig");
const firebase = require("firebase");
firebase.initializeApp(firebaseConfig);

const {
  validateSignUpData,
  validateLogInData,
  reduceUserDetails
} = require("../util/validators");

// Sign user up
exports.signUp = (req, res) => {
  const newUser = {
    email: req.body.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
    handle: req.body.handle
  };

  const { valid, errors } = validateSignUpData(newUser);
  if (!valid) return res.status(400).json(errors);

  const noImg = "no-img.png";

  let token, userId;
  db.doc(`/users/${newUser.handle}`)
    .get()
    .then(doc => {
      console.log("doc", doc);
      if (doc.exists) {
        return res.status(400).json({ handle: "this handle is already taken" });
      } else {
        return firebase
          .auth()
          .createUserWithEmailAndPassword(newUser.email, newUser.password)
          .then(data => {
            userId = data.user.uid;
            console.log("data.user", data.user);
            return data.user.getIdToken();
          })
          .then(idToken => {
            console.log("newUser.handle", newUser.handle);
            token = idToken;
            const userCredentials = {
              handle: newUser.handle,
              email: newUser.email,
              createdAt: new Date().toISOString(),
              imageUrl: `https://firebasestorage.googleapis.com/v0/b/${
                firebaseConfig.storageBucket
              }/o/${noImg}?alt=media`,
              userId
            };
            return db.doc(`/users/${newUser.handle}`).set(userCredentials);
          })
          .then(() => {
            return res.status(201).json({ token });
          })
          .catch(err => {
            if (err.code === "auth/email-already-in-use") {
              return res
                .status(400)
                .json({ email: "this email is already in use" });
            } else {
              return res.status(500).json({ error: err.code });
            }
          });
      }
    });
};

//Log user in
exports.logIn = (req, res) => {
  const user = {
    email: req.body.email,
    password: req.body.password
  };

  const { valid, errors } = validateLogInData(user);
  if (!valid) {
    return res.status(400).json(errors);
  }

  firebase
    .auth()
    .signInWithEmailAndPassword(user.email, user.password)
    .then(data => data.user.getIdToken())
    .then(token => res.json({ token }))
    .catch(err => {
      console.error(err);
      if (err.code === "auth/wrong-password")
        return res
          .status(403)
          .json({ general: "Wrong password, please try again!" });
      else if (err.code === "auth/user-not-found")
        return res
          .status(403)
          .json({ general: "Email not found, please try again!" });
      else return res.status(500).json({ error: err.code });
    });
};

// add user details
exports.addUserDetails = (req, res) => {
  let userDetails = reduceUserDetails(req.body);
  db.doc(`/users/${req.user.handle}`)
    .update(userDetails)
    .then(() => {
      return res.json({ message: "Details added successfully" });
    })
    .catch(err => {
      console.error(err);
      return res.status(500).json({ error: err.code });
    });
};

// Get own user details
exports.getAuthenticatedUser = (req, res) => {
  let userData = {};
  db.doc(`/users/${req.user.handle}`)
    .get()
    .then(doc => {
      if (doc.exists) {
        userData.credentials = doc.data();
        return db
          .collection("likes")
          .where("userHandle", "==", req.user.handle)
          .get();
      }
    })
    .then(data => {
      userData.likes = [];
      data.forEach(doc => {
        userData.likes.push(doc.data());
      });
      return res.json(userData);
    })
    .catch(err => {
      console.error(err);
      return res.status(500).json({ error: err.code });
    });
};

// upload user image
exports.uploadImage = (req, res) => {
  const Busboy = require("busboy");
  const path = require("path");
  const os = require("os");
  const x = require("fs");

  console.log("path", path);

  let imageFileName;
  let imageToBeUploaded = {};

  const busboy = new Busboy({ headers: req.headers });
  busboy.on("file", (fieldName, file, fileName, encoding, mimeType) => {
    // check if the type of file is not PNG or JPEG
    if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
      return res.status(400).json({ message: "wrong file type submited" });
    }

    //get the extension and create a new name
    imageExtension = fileName.split(".")[fileName.split(".").length - 1];
    const imageFileName = `${Math.round(
      Math.random() * 100000000000
    )}.${imageExtension}`;

    // create a file path to upload
    const filePath = path.join(os.tmpdir(), imageFileName);
    imageToBeUploaded = { filePath, mimeType };

    // opens up the writeable stream to `output`(filePath), then pipes the POST data to the file
    file.pipe(fs.createWriteStream(filePath));
  });

  busboy.on("finish", () => {
    // upload the file to Firebase
    admin
      .storage()
      .bucket()
      .upload(imageToBeUploaded.filePath, {
        resumable: false,
        metadata: {
          metadata: {
            contentType: imageToBeUploaded.mimeType
          }
        }
      })
      .then(() => {
        const imgUrl = `https://firebasestorage.googleapis.com/v0/b/${
          firebaseConfig.storageBucket
        }/o/${imageFileName}?alt=media`;
        return db.doc(`users/${req.user.handle}`).update({ imgUrl });
      })
      .then(() => {
        return res.json({ message: "Image uploaded successfully" });
      })
      .catch(err => {
        console.log(err);
        return res.status(500).json({ error: err.code });
      });
  });
  busboy.end(req.rawBody);
};
