const admin = require("firebase-admin");
const functions = require("firebase-functions");
const {DateTime} = require("luxon");

admin.initializeApp();
const db = admin.firestore();

/**
 * Fetches all users from the "app_users" collection.
 * @return {Promise<Array<{uid: string}>>} A promise that resolves
 *  to a list of user objects with uids.
 */
async function getAllUser() {
  const snapshot = await db.collection("app_users").get();
  return snapshot.docs.map((doc) => ({
    uid: doc.data().uid.toString(),
  }));
}

/**
 * Fetches all user journals from the "user_journals" collection.
 * @return {Promise<Array<{uid: string, rememberThisDayBy:
 * string, moodToday: string, challenges: string}>>}
 * A promise that resolves to a list of user journal objects.
 */
async function getUsersJournals() {
  const snapshot = await db.collection("user_journals").get();
  return snapshot.docs.map((doc) => ({
    uid: doc.data().uid,
    rememberThisDayBy: doc.data().rememberThisDayBy,
    moodToday: doc.data().moodToday,
    challenges: doc.data().challenges,
  }));
}

/**
 * Generates insights for each user based on their journals using OpenAI.
 * @return {Promise<Array<{insight: string, uid: string}>>}
 * A promise that resolves to a list of user insights objects.
 */
async function generateUserInsights() {
  const users = await getAllUser();
  const journals = await getUsersJournals();
  const insightsList = [];

  for (const singleUser of users) {
    const userId = singleUser.uid;
    const userJournals = journals.filter((journal) => journal.uid === userId);
    if (userJournals.length > 0) {
      const data = JSON.stringify(userJournals);
      const response = await fetchInsightsFromOpenAI(data);
      if (response) {
        insightsList.push({
          insight: response,
          uid: userId,
        });
      }
    }
  }

  return insightsList;
}

/**
 * Fetches insights from the OpenAI API based on the provided journal entries.
 *
 * @param {string} journals - A JSON string of the user's journal entries.
 * @return {Promise<string>} A promise that resolves to a string containing
 *  the insights.
 */
async function fetchInsightsFromOpenAI(journals) {
  const key = ""; // TODO : Attach key here.

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: `Respond as the second person (You), who was asked thes
                    three questions: [My mood today?, I'll remember this day by?
                    , Challenges I'm facing] on a daily basis, and his answers
              were these: ${journals}. Based on these entries, give him three
               insights about him. Respond with a single List<String>
                containing a maximum of 3 strings in the following format:
                        ['Insight 1', 'Insight 2', 'Insight 3']`,
          },
        ],
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`HTTP ${response.status}: ${errorData.error.message}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error fetching insights:", error);
    throw error;
  }
}

exports.addInsights = functions.https.onCall(async (data, context) => {
  try {
    const insightsList = await generateUserInsights();
    const batch = db.batch();

    insightsList.forEach((insight) => {
      const ref = db.collection("users_insights").doc(insight.uid);
      batch.set(ref, {
        insights: insight.insight,
        uid: insight.uid,
        createdAt: DateTime.now().toMillis(),
      });
    });

    await batch.commit();

    return {message: "Insights added successfully."};
  } catch (error) {
    console.error("Error adding insights:", error);
    throw new functions.https.HttpsError("internal", "Failed to add insights.");
  }
});
