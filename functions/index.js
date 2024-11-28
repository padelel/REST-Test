const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
});

const express = require("express");
const cors = require("cors");

// Main App
const app = express();
app.use(cors({ origin: true }));
const db = admin.firestore();



// token untuk firebase Auth
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send("Unauthorized: No token provided");
    }

    const idToken = authHeader.split("Bearer ")[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(401).send("Unauthorized: Invalid token");
    }
};

// Add Transaction
app.post("/transaction", authenticate, async (req, res) => {
    const { type, category, amount } = req.body;


    if (!type || !category || !amount) {
        return res.status(400).send("Bad Request: Missing required fields");
    }

    try {
        const categoryRef = db.collection("categories").doc(category);
        const categoryDoc = await categoryRef.get();

        if (!categoryDoc.exists) {
            return res.status(400).send("Bad Request: Invalid category");
        }

        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        // Hitung saldo baru
        const currentSaldo = userDoc.data().saldo || 0;
        const updatedSaldo = type === "Income"
            ? currentSaldo + parseFloat(amount)
            : currentSaldo - parseFloat(amount);

        // Update saldo user
        await userRef.update({ saldo: updatedSaldo });

        // Tambahkan transaksi ke Firestore
        const newTransactionRef = db.collection("transactions").doc();
        const newTransactionId = newTransactionRef.id;

        const newTransaction = {
            id: newTransactionId, // Simpan ID transaksi ke dokumen
            user_id: req.user.uid,
            type,
            category,
            amount: parseFloat(amount),
            date: new Date(),
        };

        await newTransactionRef.set(newTransaction);

        return res.status(201).send({
            message: "Transaction added successfully",
            newTransaction,
        });
    } catch (error) {
        console.error("Error adding transaction:", error);
        return res.status(500).send("Error adding transaction: " + error.message);
    }
});


// Kurangi atau Tambahkan Saldo Saat Transaksi Dihapus
app.delete("/transaction/:transactionId", authenticate, async (req, res) => {
    const { transactionId } = req.params;

    try {
        const transactionRef = db.collection("transactions").doc(transactionId);
        const transactionDoc = await transactionRef.get();

        if (!transactionDoc.exists) {
            return res.status(404).send("Transaction not found");
        }

        const transactionData = transactionDoc.data();

        if (transactionData.user_id !== req.user.uid) {
            return res.status(403).send("Forbidden: You are not authorized to delete this transaction");
        }

        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        // Update saldo berdasarkan tipe transaksi
        const currentSaldo = userDoc.data().saldo || 0;
        const updatedSaldo = transactionData.type === "Income"
            ? currentSaldo - parseFloat(transactionData.amount)
            : currentSaldo + parseFloat(transactionData.amount);

        await userRef.update({ saldo: updatedSaldo });

        await transactionRef.delete();
        return res.status(200).send({ message: "Transaction deleted successfully" });
    } catch (error) {
        console.error("Error deleting transaction:", error);
        return res.status(500).send("Error deleting transaction: " + error.message);
    }
});


// edit user
app.patch("/edit-user", authenticate, async (req, res) => {
    const { username, photo } = req.body;

    if (!username && !photo) {
        return res.status(400).send({
            error: "Bad Request",
            message: "At least one of username or photo must be provided.",
        });
    }

    try {
        const userId = req.user.uid;
        const userRef = db.collection("users").doc(userId);

        const updateData = {};
        if (username) updateData.username = username;
        if (photo) updateData.photo = photo; // Perbarui photo jika ada

        await userRef.update(updateData);

        return res.status(200).send({
            message: "User updated successfully",
            updatedFields: updateData,
        });
    } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).send({
            error: "Internal Server Error",
            message: error.message,
        });
    }
});


// riwayat per bulan
app.get("/transactions/monthly", authenticate, async (req, res) => {
    const { type, month, year } = req.query;

    if (!type || !month || !year) {
        return res.status(400).send("Bad Request: Missing required fields (type, month, year).");
    }

    try {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        if (type === "All") {
            // Query 'Income' transactions
            const incomeQuery = db.collection("transactions")
                .where("user_id", "==", req.user.uid)
                .where("type", "==", "Income")
                .where("date", ">=", startDate)
                .where("date", "<=", endDate);
            const incomeSnapshot = await incomeQuery.get();

            // Query 'Outcome' transactions
            const outcomeQuery = db.collection("transactions")
                .where("user_id", "==", req.user.uid)
                .where("type", "==", "Outcome")
                .where("date", ">=", startDate)
                .where("date", "<=", endDate);
            const outcomeSnapshot = await outcomeQuery.get();

            // Combine results
            const incomeTransactions = incomeSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                date: doc.data().date.toDate().toISOString(), // Convert date to ISO string
            }));

            const outcomeTransactions = outcomeSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                date: doc.data().date.toDate().toISOString(),
            }));

            const allTransactions = [...incomeTransactions, ...outcomeTransactions];

            if (allTransactions.length === 0) {
                return res.status(404).send({ message: `No transactions found for ${month}-${year}.` });
            }

            return res.status(200).send({
                message: `All transactions (Income and Outcome) for ${month}-${year}`,
                transactions: allTransactions,
            });
        } else {
            // Query specific type (Income or Outcome)
            const transactionsQuery = db.collection("transactions")
                .where("user_id", "==", req.user.uid)
                .where("type", "==", type)
                .where("date", ">=", startDate)
                .where("date", "<=", endDate);
            const snapshot = await transactionsQuery.get();

            if (snapshot.empty) {
                return res.status(404).send({ message: `No ${type} transactions found for ${month}-${year}.` });
            }

            const transactions = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                date: doc.data().date.toDate().toISOString(),
            }));

            return res.status(200).send({
                message: `${type} transactions for ${month}-${year}`,
                transactions,
            });
        }
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});

// Endpoint: Get latest 5 transactions
app.get("/transactions/latest", authenticate, async (req, res) => {
    try {
        const transactionsQuery = db.collection("transactions")
            .where("user_id", "==", req.user.uid)
            .orderBy("date", "desc")
            .limit(5);

        const snapshot = await transactionsQuery.get();

        if (snapshot.empty) {
            return res.status(404).send({ message: "No transactions found" });
        }

        const transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date.toDate().toISOString(), // Convert date to ISO string
        }));

        return res.status(200).send({
            message: "Latest 5 transactions retrieved successfully",
            transactions,
        });
    } catch (error) {
        console.error("Error fetching latest transactions:", error);
        return res.status(500).send({ error: "Internal Server Error", message: error.message });
    }
});


// Add a new category
app.post("/category", async (req, res) => {
    const { name, defaultCategory } = req.body;

    if (!name) {
        return res.status(400).send("Bad Request: Missing required fields");
    }

    try {
        const newCategory = {
            name,
            default: defaultCategory || false,
        };

        await db.collection("categories").doc(name).set(newCategory);
        return res.status(201).send({ message: "Category added successfully", newCategory });
    } catch (error) {
        return res.status(500).send("Error adding category: " + error.message);
    }
});

// Register User - Tambahkan Saldo Awal
app.post("/register", async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).send("All fields are required");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).send("Gunakan valid email");
    }

    try {
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: username,
        });

        await db.collection("users").doc(userRecord.uid).set({
            username,
            email,
            saldo: 0, // Set saldo awal menjadi 0
            photo: null, // Set photo sebagai null
        });

        res.status(201).send("User registered successfully");
    } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).send("Error registering user");
    }
});



app.get("/saldo", authenticate, async (req, res) => {
    try {
        // Referensi ke dokumen user berdasarkan UID
        const userRef = db.collection("users").doc(req.user.uid);
        const userDoc = await userRef.get();

        // Periksa apakah user ditemukan
        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        // Ambil saldo dari dokumen user
        const saldo = userDoc.data().saldo || 0;

        return res.status(200).send({
            message: "Saldo retrieved successfully",
            saldo,
        });
    } catch (error) {
        console.error("Error retrieving saldo:", error);
        return res.status(500).send("Error retrieving saldo: " + error.message);
    }
});


// Endpoint untuk mendapatkan data pengguna setelah login
app.get("/user", authenticate, async (req, res) => {
    try {
        const userRecord = await admin.auth().getUser(req.user.uid);
        res.status(200).send(userRecord);
    } catch (error) {
        console.error("Error fetching user data:", error.message);
        res.status(500).send("Error fetching user data");
    }
});


// Export the app
exports.app = functions.https.onRequest(app);