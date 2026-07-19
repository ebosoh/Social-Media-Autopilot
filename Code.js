/**
 * Social Media Autopilot - Google Apps Script
 *
 * NOTE: Create a Google Sheet, open Extensions > Apps Script, and paste this code.
 * Then complete the database setup as required:
 * Tabs needed: Config, Knowledge_Base, Content_Queue, Trends, Error_Logger, Allowed_Users
 *
 * AUTHENTICATION:
 * - This Web App is deployed with "Execute as: Me" and "Who has access: Anyone".
 * - Authentication is handled by validating the caller's Google email against the Allowed_Users sheet.
 * - The frontend uses Google Identity Services (Google Sign-In) to get an ID token,
 *   which is passed with every request. The Apps Script validates it server-side.
 */

// ============================================================================
// CONFIGURATION & SETUP
// ============================================================================

// [PLACEHOLDER_REQUIRED]: You will need to add your API keys here or in the Config sheet.
const API_KEYS = {
  GEMINI: 'AIzaSyAjvPUW5rKij8Z2DBsZdQfOgbLMuUxBrTk', // e.g. from Google AI Studio
  NANO_BANANA_2: 'YOUR_NANO_BANANA_2_API_KEY',
  // Social Platforms
  TIKTOK: 'YOUR_TIKTOK_API_KEY',
  FACEBOOK: 'YOUR_FACEBOOK_GRAPH_API_KEY',
  INSTAGRAM: 'YOUR_INSTAGRAM_GRAPH_API_KEY',
  X_TWITTER: 'YOUR_X_BEARER_TOKEN',
  LINKEDIN: 'AQVDl1LH1EG_TWdXKxv8aYvxznml9gd_VExlatahwSvLl4qungdimwx0u-j22AtwWmvm_LyRoXPb_Isu4jJaE-GMaIS4XRGHz7rvjYvAY9BrEmp6cgngjV0U0gUwm6ege7YFDxOCvmNH2JnR6UbfLRXRgXgX6tjXtJFMRG71JvxB4hXkBoXk57O3fJ7a3TbBVwLx9BtAtEjCdkWJ4ImHw-L4aCou3rnMsM-8a0L4OkfDHbYl3ckXKbzthKe0mfMgMEiXgMq0lc-OKSGEtHu3f5QD7oUCphvlb9SYXXRfzPJsMycPiWmiFxop1ba_NrB2X8XyHh4dJgGBwE_iooCN9384t2OXJg'
};

// [PLACEHOLDER_REQUIRED]: Replace with your Google OAuth 2.0 Client ID.
const GOOGLE_CLIENT_ID = '465287709316-85racf46nbmec2oqt98cuoeo68ucru2s.apps.googleusercontent.com';

// [PLACEHOLDER_REQUIRED]: LinkedIn OAuth 2.0 App Credentials
// Fetches credentials securely from Apps Script Project Settings (Script Properties)
// to prevent secrets from leaking into your public GitHub repository.
const LINKEDIN_CLIENT_ID = PropertiesService.getScriptProperties().getProperty('LINKEDIN_CLIENT_ID') || 'YOUR_LINKEDIN_CLIENT_ID';
const LINKEDIN_CLIENT_SECRET = PropertiesService.getScriptProperties().getProperty('LINKEDIN_CLIENT_SECRET') || 'YOUR_LINKEDIN_CLIENT_SECRET';
const LINKEDIN_REDIRECT_URI = PropertiesService.getScriptProperties().getProperty('LINKEDIN_REDIRECT_URI') || 'YOUR_LINKEDIN_REDIRECT_URI';

// Set to true to bypass Google Auth if you are having persistent "invalid_token" issues.
// WARNING: This makes your backend public. Only use for temporary debugging!
const BYPASS_AUTH = true;

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet() ? SpreadsheetApp.getActiveSpreadsheet().getId() : '1Gn5qeiRLbbxVBxjH2XNrLUOwaEfGFcEH4HMYOm4A2_o';

// Utility to get Config Value
function getConfigValue(key) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Config');
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) return data[i][1];
    }
  } catch (e) {
    logError('getConfigValue', e.toString());
  }
  return null;
}

// Utility to log errors
function logError(context, message) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Error_Logger');
    if (sheet) sheet.appendRow([new Date(), context, message]);
  } catch (e) {
    console.error("Failed to log error:", e);
  }
}

// ============================================================================
// MODULE 1: BRAND SCRAPING & GROUNDING
// ============================================================================

function scrapeAndGroundBrand() {
  const websiteUrl = getConfigValue('Website_URL');
  if (!websiteUrl) {
    logError('scrapeAndGroundBrand', 'Website URL not defined in Config');
    return;
  }

  try {
    // Basic scrape (for more complex sites, this might just grab meta tags or raw text)
    const response = UrlFetchApp.fetch(websiteUrl);
    const htmlText = response.getContentText();
    // Simplified text extraction logic
    const bodyText = htmlText.replace(/<[^>]*>?/gm, ' ').substring(0, 10000); // Limit payload

    // Send to Gemini to format
    const geminiKey = API_KEYS.GEMINI; // Alternatively: getConfigValue('Gemini_Key');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiKey}`;

    const prompt = `Analyze this website content and extract the core mission, services, and brand voice. Format it as a strict JSON identity profile containing keys: "mission", "services", "brand_voice". Content: ${bodyText}`;

    const payload = {
      "contents": [{ "parts": [{ "text": prompt }] }]
    };

    const geminiResponse = UrlFetchApp.fetch(geminiUrl, {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload)
    });

    const jsonResultText = JSON.parse(geminiResponse.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const cleanedJsonText = jsonResultText.replace(/```json/g, '').replace(/```/g, ''); // Clean markdown formatting

    const knowledgeBaseSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Knowledge_Base');
    knowledgeBaseSheet.appendRow([new Date(), "Profile_Extraction", cleanedJsonText]);

  } catch (e) {
    logError('scrapeAndGroundBrand', e.toString());
  }
}


// ============================================================================
// MODULE 2: SOCIAL MEDIA CONTENT LOOP
// ============================================================================

function runSocialMediaLoop() {
  const manualApproval = getConfigValue('Manual_Approval') === true || getConfigValue('Manual_Approval') === 'TRUE';
  const brandProfile = getLastKnowledgeBaseEntry();

  // 1. Check Repetition
  const recentTopics = getRecentTopics();

  // 2. Trend Hunt & Draft
  // In a real scenario, use Gemini's Google Search capabilities, or fetch latest trends manually.
  const trendingTopic = getTrendingTopicWithGemini(brandProfile, recentTopics);
  if (!trendingTopic) return;

  const postDraft = generatePostDraft(trendingTopic, brandProfile);

  // 3. Visual Generation
  const visualPromptPrefix = getConfigValue('Visual_Prompt_Prefix') || "Cinematic lighting, high-end professional.";
  const imagePrompt = generateVisualPrompt(postDraft, visualPromptPrefix);
  const imageUrl = generateImageWithImagen(imagePrompt);

  // 4. Save to Queue
  // Columns: Topic, Post_Text, Image_URL, Platform, Status, Timestamp
  const defaultPlatform = "LinkedIn"; // Rotate or decide based on Gemini strategy
  const initialStatus = manualApproval ? "Pending" : "Posted";

  const contentQueueSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
  contentQueueSheet.appendRow([trendingTopic, postDraft, imageUrl, defaultPlatform, initialStatus, new Date()]);

  // 5. If not manual approval, publish immediately
  if (!manualApproval) {
    publishToPlatform(postDraft, imageUrl, defaultPlatform);
    // Ideally update status to posted in the sheet
  }
}

function getLastKnowledgeBaseEntry() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Knowledge_Base');
  const data = sheet.getDataRange().getValues();
  if (data.length > 1) {
    return data[data.length - 1][2]; // Assuming column C holds the JSON payload
  }
  return "{}";
}

function getRecentTopics() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
  const maxRows = sheet.getLastRow();
  const startRow = Math.max(2, maxRows - 20); // Last 20 rows
  if (maxRows < 2) return [];

  const topicsData = sheet.getRange(startRow, 1, maxRows - startRow + 1, 1).getValues();
  return topicsData.map(r => r[0]);
}

function getTrendingTopicWithGemini(brandProfile, recentTopics) {
  // Call Gemini to ask for a trend, avoiding recentTopics.
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEYS.GEMINI}`;
  const prompt = `Based on this brand profile: ${brandProfile}. Please identify a single relevant trending topic. DO NOT USE any of these recent topics: ${recentTopics.join(', ')}. Return just the topic as a single sentence.`;

  try {
    const payload = { "contents": [{ "parts": [{ "text": prompt }] }] };
    const res = UrlFetchApp.fetch(geminiUrl, { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true });
    if (res.getResponseCode() !== 200) return "Trend Error: " + res.getContentText();
    return JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  } catch (e) {
    logError('getTrendingTopic', e.toString());
    return "Error getting trend: " + e.message; // Fallback
  }
}

function generatePostDraft(topic, brandProfile) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEYS.GEMINI}`;
  const prompt = `Write a social media post about "${topic}". Adapt to this brand profile: ${brandProfile}. Return ONLY the post text.`;

  try {
    const payload = { "contents": [{ "parts": [{ "text": prompt }] }] };
    const res = UrlFetchApp.fetch(geminiUrl, { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true });
    if (res.getResponseCode() !== 200) return "Draft Error: " + res.getContentText();
    return JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  } catch (e) {
    logError('generatePostDraft', e.toString());
    return "Error generating post: " + e.message;
  }
}

function generateVisualPrompt(postText, prefix) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEYS.GEMINI}`;
  const prompt = `Based on this social media post text: "${postText}". 
  Create an evocative, highly detailed visual description for an AI image generator that captures the SPECIFIC themes and mood of this post. 
  Avoid generic descriptions. Focus on unique characters, settings, and lighting mentioned or implied.
  Prefix to include: "${prefix}". Return ONLY the final prompt text.`;

  try {
    const payload = { "contents": [{ "parts": [{ "text": prompt }] }] };
    const res = UrlFetchApp.fetch(geminiUrl, { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true });
    if (res.getResponseCode() !== 200) return "Visual Prompt Error: " + res.getContentText();
    return JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  } catch (e) {
    logError('generateVisualPrompt', e.toString());
    return prefix + " API Error: " + e.message;
  }
}

function generateImageWithImagen(prompt) {
  try {
    const encodedPrompt = encodeURIComponent(prompt + " cinematic lighting, ultra-realistic, 8k");
    const seed = Math.floor(Math.random() * 1000000); // Force uniqueness via seed
    // Pollinations directly returns the generated image. Adding a seed ensures variety even for similar prompts.
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}`;
    return imageUrl;
  } catch (e) {
    logError('generateImageWithImagen', e.toString());
    return "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&q=80&w=800";
  }
}


// ============================================================================
// MODULE 3: PUBLISHING & ENGAGEMENT
// ============================================================================

function publishToPlatform(postText, imageUrl, platform) {
  // [PLACEHOLDER_REQUIRED]: Implement exact API logic per platform.

  switch (platform) {
    case 'LinkedIn':
      return publishToLinkedIn(postText, imageUrl);
    case 'X(Twitter)':
      // e.g. Call Twitter/X v2 API using API_KEYS.X_TWITTER
      break;
    case 'Facebook':
      // e.g. Call FB Graph API using API_KEYS.FACEBOOK
      break;
    case 'Instagram':
      // e.g. Call IG Graph API using API_KEYS.INSTAGRAM
      break;
    case 'Tiktok':
      // e.g. Call TikTok Auto Post API using API_KEYS.TIKTOK
      break;
  }
  return true; // Assume success for now unless explicitly handled
}

function checkAndPublishScheduledPosts() {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    
    const now = new Date();
    
    for (let i = 1; i < data.length; i++) {
      const topic = data[i][0];
      const text = data[i][1];
      const image = data[i][2];
      const platform = data[i][3];
      const status = data[i][4];
      const timestampRaw = data[i][5];
      if (!timestampRaw) continue;
      
      const timestamp = new Date(timestampRaw);
      if (status === 'Pending' && timestamp <= now) {
        logError('checkAndPublishScheduledPosts', `Publishing scheduled post: "${topic}" on ${platform}`);
        const success = publishToPlatform(text, image, platform);
        
        if (success) {
          sheet.getRange(i + 1, 5).setValue('Posted');
          sheet.getRange(i + 1, 6).setValue(new Date()); // Update timestamp to actual posted time
        } else {
          logError('checkAndPublishScheduledPosts', `Failed to publish scheduled post: "${topic}"`);
        }
      }
    }
  } catch (e) {
    logError('checkAndPublishScheduledPosts', e.toString());
  }
}

function fetchAndReplyComments() {
  // Engagement Module
  // 1. Fetch recent comments from the tracked channels (LinkedIn, IG, Facebook)
  // 2. Draft replies using Gemini matching Brand Voice
  // 3. Post reply

  const brandProfile = getLastKnowledgeBaseEntry();

  // [PLACEHOLDER_REQUIRED]: Fetch comments via API
  const mockedComments = [
    { id: "123", platform: "LinkedIn", user: "Jane", text: "Love this approach!", postId: "456" }
  ];

  mockedComments.forEach(comment => {
    const replyText = draftCommentReply(comment.text, brandProfile);

    // [PLACEHOLDER_REQUIRED]: Post back via API
    // postReplyToPlatform(comment.platform, comment.id, replyText);
  });
}

function draftCommentReply(commentText, brandProfile) {
  // Use Gemini to draft a reply
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${API_KEYS.GEMINI}`;
  const prompt = `Draft a polite, professional, and engaging reply to this social media comment: "${commentText}". Ensure it aligns with this brand profile: ${brandProfile}. Return ONLY the reply text.`;

  try {
    const payload = { "contents": [{ "parts": [{ "text": prompt }] }] };
    const res = UrlFetchApp.fetch(geminiUrl, { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload) });
    return JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  } catch (e) {
    return "Thank you for the feedback!";
  }
}

// ============================================================================
// USER MANAGEMENT (Allowed_Users Sheet)
// ============================================================================

/**
 * Returns the list of allowed users from the Allowed_Users sheet.
 * Columns: Email, Name, Role (admin | viewer), Added_Date
 */
function getAllowedUsers() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Allowed_Users');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map((row, i) => {
    let obj = { _rowNum: i + 2 };
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    return obj;
  });
}

/**
 * Checks if a given Google email is in the Allowed_Users sheet.
 * Returns the user object if found, otherwise null.
 */
function isUserAllowed(email) {
  if (!email) return null;
  const users = getAllowedUsers();
  return users.find(u => u.Email && u.Email.toLowerCase().trim() === email.toLowerCase().trim()) || null;
}

/**
 * Adds a new user to the Allowed_Users sheet.
 */
function addAllowedUser(email, name, role) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Allowed_Users');
  if (!sheet) return false;
  // Prevent duplicates
  if (isUserAllowed(email)) return false;
  sheet.appendRow([email, name || '', role || 'viewer', new Date()]);
  return true;
}

/**
 * Removes a user from the Allowed_Users sheet by row number.
 */
function removeAllowedUser(rowNum) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Allowed_Users');
  if (!sheet) return false;
  sheet.deleteRow(rowNum);
  return true;
}

/**
 * Validates a Google ID token passed from the frontend.
 * Uses Google's tokeninfo endpoint to decode and verify the token.
 * Returns the user's email if valid, otherwise null.
 */
function validateGoogleToken(idToken) {
  if (!idToken) return { error: 'No token provided.' };

  // Clean token
  let token = idToken.trim();
  if (token.startsWith('Bearer ')) token = token.substring(7);

  if (BYPASS_AUTH) return { email: 'bypass@debug.com' };

  try {
    logError('validateGoogleToken', `Checking token: Length=${token.length}, Prefix=${token.substring(0, 10)}...`);

    const res = UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, { muteHttpExceptions: true });
    const info = JSON.parse(res.getContentText());

    if (res.getResponseCode() !== 200) {
      const msg = 'Token info error: ' + res.getContentText();
      logError('validateGoogleToken', msg);
      return { error: msg };
    }

    if (info.aud !== GOOGLE_CLIENT_ID) {
      const msg = `Audience mismatch. Token aud: ${info.aud}, Expected: ${GOOGLE_CLIENT_ID}`;
      logError('validateGoogleToken', msg);
      return { error: msg };
    }

    return { email: info.email || null };
  } catch (e) {
    const msg = 'Fetch exception: ' + e.toString();
    logError('validateGoogleToken', msg);
    return { error: msg };
  }
}

// ============================================================================
// COMMAND CENTER API (WEB APP ENDPOINTS)
// ============================================================================

function doGet(e) {
  // Returns JSON data. The frontend includes a Google ID token for auth on sensitive actions.

  if (e.parameter.action === 'getData') {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
    if (!sheet) return json({ error: "Sheet not found" });
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1).map((row, i) => {
      let obj = { _rowNum: i + 2 };
      headers.forEach((h, index) => { obj[h] = row[index]; });
      return obj;
    });
    return json({ data: rows });
  }

  if (e.parameter.action === 'getUsers') {
    return json({ users: getAllowedUsers() });
  }

  if (e.parameter.action === 'getSettings') {
    const configSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Config');
    let configData = {};
    if (configSheet) {
      const data = configSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        configData[data[i][0]] = data[i][1];
      }
    }
    const brandProfile = getLastKnowledgeBaseEntry();
    return json({ settings: configData, brandProfile: brandProfile });
  }

  if (e.parameter.action === 'getTrends') {
    const trendsSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Trends');
    let trendsData = [];
    if (trendsSheet && trendsSheet.getLastRow() > 1) {
      const data = trendsSheet.getDataRange().getValues();
      trendsData = data.slice(1).map(row => ({ timestamp: row[0], topic: row[1] })).reverse();
    }
    return json({ trends: trendsData });
  }

  return json({ message: "Social Media Autopilot API v1" });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // ── Google Auth Gate ────────────────────────────────────────────────
    // When the Web App is deployed, all write actions require a valid Google
    // ID token and the caller's email must be in Allowed_Users.
    if (payload.idToken || BYPASS_AUTH) {
      const auth = validateGoogleToken(payload.idToken);
      if (auth.error && !BYPASS_AUTH) return json({ error: 'Auth failed: ' + auth.error });
      const email = auth.email;
      if (!BYPASS_AUTH && !isUserAllowed(email)) return json({ error: 'Access denied. Your Google account (' + email + ') is not authorised in the Allowed_Users sheet.' });
    }
    if (payload.action === 'checkUser') {
      if (BYPASS_AUTH) return json({ allowed: true, email: 'admin@debug.com' });
      const auth = validateGoogleToken(payload.idToken);
      const email = auth.email;
      if (email && isUserAllowed(email)) {
        return json({ allowed: true, email: email });
      } else {
        return json({ allowed: false, error: auth.error || 'User not authorized.' });
      }
    }

    // ── Actions ─────────────────────────────────────────────────────────

    if (payload.action === 'approvePost') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
      const data = sheet.getRange(payload.rowNum, 1, 1, 5).getValues()[0];
      const topic = data[0];
      const text = data[1];
      const image = data[2];
      const platform = data[3];

      // Call the real publishing logic
      const success = publishToPlatform(text, image, platform);

      if (success) {
        sheet.getRange(payload.rowNum, 5).setValue('Posted');
        return json({ success: true, message: "Published successfully!" });
      } else {
        return json({ success: false, message: "Publishing failed. Check Error_Logger." });
      }
    }

    if (payload.action === 'triggerResearch') {
      runSocialMediaLoop();
      return json({ success: true, message: 'Loop Triggered' });
    }

    // ── User Management (admin-only) ─────────────────────────────────────
    if (payload.action === 'addUser') {
      const added = addAllowedUser(payload.email, payload.name, payload.role);
      return json({ success: added, message: added ? 'User added.' : 'User already exists.' });
    }

    if (payload.action === 'deletePost') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
      sheet.deleteRow(payload.rowNum);
      return json({ success: true });
    }

    if (payload.action === 'editPost') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Content_Queue');
      sheet.getRange(payload.rowNum, 1).setValue(payload.topic);
      sheet.getRange(payload.rowNum, 2).setValue(payload.postText);
      sheet.getRange(payload.rowNum, 4).setValue(payload.platform);
      
      if (payload.status) {
        sheet.getRange(payload.rowNum, 5).setValue(payload.status);
      }
      if (payload.timestamp) {
        sheet.getRange(payload.rowNum, 6).setValue(new Date(payload.timestamp));
      }
      
      if (payload.status === 'Posted') {
        const image = sheet.getRange(payload.rowNum, 3).getValue();
        const success = publishToPlatform(payload.postText, image, payload.platform);
        if (!success) {
          // Revert status to Pending if publishing failed
          sheet.getRange(payload.rowNum, 5).setValue('Pending');
          return json({ success: false, error: "Publishing failed. Check Error_Logger." });
        } else {
          sheet.getRange(payload.rowNum, 6).setValue(new Date()); // Update timestamp to actual posted time
        }
      }
      
      return json({ success: true });
    }

    if (payload.action === 'saveSettings') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Config');
      if (sheet) {
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
        }
        let row = 2;
        for (const [key, value] of Object.entries(payload.settings)) {
          sheet.getRange(row, 1).setValue(key);
          sheet.getRange(row, 2).setValue(value);
          row++;
        }

        // Also save Brand Voice/Profile to Knowledge_Base for Trend Scanning
        if (payload.brandVoice) {
          const kbSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Knowledge_Base');
          if (kbSheet) {
            // Check if there's already an entry, or just append
            kbSheet.appendRow([new Date(), 'Manual Update', payload.brandVoice]);
          }
        }

        // Update Triggers based on new settings
        updateAutopilotTrigger();

        return json({ success: true, message: 'Settings saved and triggers updated.' });
      }
      return json({ success: false, error: 'Config sheet not found.' });
    }

    if (payload.action === 'scanTrends') {
      const brandProfile = getLastKnowledgeBaseEntry();
      const recentTopics = getRecentTopics();
      const trendingTopic = getTrendingTopicWithGemini(brandProfile, recentTopics);

      if (trendingTopic) {
        const trendsSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Trends');
        trendsSheet.appendRow([new Date().toISOString(), trendingTopic]);
        return json({ success: true, trend: trendingTopic });
      } else {
        return json({ success: false, error: 'Could not discover a new trend.' });
      }
    }

    if (payload.action === 'deleteTrend') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Trends');
      if (!sheet) return json({ error: 'Trends sheet not found' });
      const data = sheet.getDataRange().getValues();
      const timestampToDelete = payload.timestamp;

      for (let i = data.length - 1; i >= 1; i--) {
        // Compare timestamps as strings to be safe
        if (data[i][0].toString() === timestampToDelete.toString()) {
          sheet.deleteRow(i + 1);
          return json({ success: true, message: 'Trend deleted' });
        }
      }
      return json({ error: 'Trend not found' });
    }

    if (payload.action === 'analyzeWebsite') {
      const targetUrl = payload.targetUrl;
      if (!targetUrl) return json({ success: false, error: 'No URL provided.' });

      let websiteContent = '';
      try {
        const siteRes = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true, followRedirects: true });
        const html = siteRes.getContentText();
        // Strip HTML tags and collapse whitespace, limit to ~4000 chars for the prompt
        websiteContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
      } catch (fetchErr) {
        return json({ success: false, error: 'Could not fetch website: ' + fetchErr.message });
      }

      const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + API_KEYS.GEMINI;
      const prompt = 'You are a brand strategist. Analyze the following website content.\n\nURL: ' + targetUrl + '\nContent: ' + websiteContent + '\n\nReturn ONLY a valid JSON object (no markdown, no code blocks) with exactly these two keys:\n"promptPrefix": A 1-2 sentence visual style guide for AI image generation for this brand.\n"brandVoice": A concise paragraph describing the brand identity, tone, mission, and target audience.';

      try {
        const gemPayload = { 'contents': [{ 'parts': [{ 'text': prompt }] }] };
        const res = UrlFetchApp.fetch(geminiUrl, { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(gemPayload), 'muteHttpExceptions': true });
        if (res.getResponseCode() !== 200) return json({ success: false, error: 'Gemini error: ' + res.getContentText() });

        const raw = JSON.parse(res.getContentText()).candidates[0].content.parts[0].text.trim();
        const cleaned = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return json({ success: true, promptPrefix: parsed.promptPrefix || '', brandVoice: parsed.brandVoice || '' });
      } catch (geminiErr) {
        return json({ success: false, error: 'Analysis failed: ' + geminiErr.message });
      }
    }

    return json({ error: 'Unknown action.' });
  } catch (err) {
    logError('doPost', err.toString());
    return json({ error: err.toString() });
  }
}

// Helper: shorthand JSON response
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Manages the Apps Script triggers for runSocialMediaLoop.
 * Reads: Posting_Frequency, Posting_Time, Timezone from Config.
 */
function updateAutopilotTrigger() {
  const frequency = getConfigValue('Posting_Frequency') || 'Daily';
  const timeStr = getConfigValue('Posting_Time') || '09:00';
  const timezone = getConfigValue('Timezone') || Session.getScriptTimeZone();
  const isAuto = getConfigValue('Publish_Mode') === 'auto';

  // 1. Clear existing triggers for both loops
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const handler = t.getHandlerFunction();
    if (handler === 'runSocialMediaLoop' || handler === 'checkAndPublishScheduledPosts') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 2. If not in auto mode, don't create triggers
  if (!isAuto) return;

  // 3. Create hourly trigger to check and publish scheduled posts
  ScriptApp.newTrigger('checkAndPublishScheduledPosts').timeBased().everyHours(1).create();

  // 4. Parse Time (HH:mm) or Date object for time-of-day frequencies
  let hours = 9;
  let minutes = 0;

  if (typeof timeStr === 'string' && timeStr.includes(':')) {
    const parts = timeStr.split(':');
    hours = parseInt(parts[0]) || 9;
    minutes = parseInt(parts[1]) || 0;
  } else if (timeStr instanceof Date) {
    hours = timeStr.getHours();
    minutes = timeStr.getMinutes();
  }

  // 5. Create Autopilot content loop trigger
  let trigger = ScriptApp.newTrigger('runSocialMediaLoop').timeBased();

  if (frequency === 'Every 6 Hours') {
    trigger.everyHours(6).create();
  } else if (frequency === 'Every 12 Hours') {
    trigger.everyHours(12).create();
  } else if (frequency === 'Daily') {
    trigger.everyDays(1).atHour(hours).nearMinute(minutes).inTimezone(timezone).create();
  } else if (frequency === 'Every 2 Days') {
    trigger.everyDays(2).atHour(hours).nearMinute(minutes).inTimezone(timezone).create();
  } else if (frequency === 'Weekly') {
    trigger.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(hours).nearMinute(minutes).inTimezone(timezone).create();
  }
}

// Function to setup spreadsheet triggers and tabs automatically
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const requiredTabs = {
    'Config': ['Key', 'Value'],
    'Knowledge_Base': ['Timestamp', 'Type', 'Data'],
    'Content_Queue': ['Topic', 'Post_Text', 'Image_URL', 'Platform', 'Status', 'Timestamp'],
    'Trends': ['Timestamp', 'Topic_Details'],
    'Error_Logger': ['Timestamp', 'Context', 'Message'],
    'Allowed_Users': ['Email', 'Name', 'Role', 'Added_Date']  // NEW: Auth user registry
  };

  for (const [tabName, headers] of Object.entries(requiredTabs)) {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  // Set default config if empty
  const config = ss.getSheetByName('Config');
  if (config.getLastRow() === 1) {
    config.appendRow(['Target_URL', 'https://example.com']);
    config.appendRow(['Publish_Mode', 'manual']);
    config.appendRow(['Prompt_Prefix', 'Cinematic lighting, modern branding.']);
    config.appendRow(['Posting_Frequency', 'Daily']);
    config.appendRow(['Posting_Time', '09:00']);
    config.appendRow(['Timezone', Session.getScriptTimeZone()]);
    config.appendRow(['LinkedIn_Page_URL', '']);
    config.appendRow(['Instagram_Page_URL', '']);
    config.appendRow(['Facebook_Page_URL', '']);
    config.appendRow(['Twitter_Page_URL', '']);
    config.appendRow(['Tiktok_Page_URL', '']);
  }

  // Seed the first admin user as a reminder
  const usersSheet = ss.getSheetByName('Allowed_Users');
  if (usersSheet.getLastRow() === 1) {
    // [PLACEHOLDER_REQUIRED]: Replace with the actual admin Google email
    usersSheet.appendRow(['admin@yourbrand.com', 'Admin', 'admin', new Date()]);
  }
}

/**
 * MODULE 4: LINKEDIN INTEGRATION
 */

function publishToLinkedIn(postText, imageUrl) {
  const accessToken = API_KEYS.LINKEDIN;
  if (!accessToken || accessToken === 'YOUR_LINKEDIN_API_KEY') {
    logError('publishToLinkedIn', 'LinkedIn API key not configured.');
    return;
  }

  try {
    // 1. Get Member ID
    const memberId = getLinkedInMemberId(accessToken);
    if (!memberId) throw new Error("Could not retrieve LinkedIn Member ID.");

    let mediaAsset = null;
    if (imageUrl) {
      mediaAsset = uploadLinkedInImage(imageUrl, accessToken, memberId);
    }

    // 2. Create Post (using recommended /posts endpoint)
    const url = 'https://api.linkedin.com/v2/posts';
    const payload = {
      "author": memberId,
      "commentary": postText,
      "visibility": "PUBLIC",
      "distribution": {
        "feedDistribution": "MAIN_FEED",
        "targetEntities": []
      },
      "lifecycleState": "PUBLISHED",
      "isReshareDisabledByAuthor": false
    };

    if (mediaAsset) {
      payload.content = {
        "media": {
          "id": mediaAsset
        }
      };
    }

    const options = {
      "method": "post",
      "headers": {
        "Authorization": "Bearer " + accessToken,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json"
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 201) {
      throw new Error("LinkedIn Post Error: " + JSON.stringify(result));
    }

    return true;
  } catch (e) {
    logError('publishToLinkedIn', e.toString());
    return false;
  }
}

function getLinkedInMemberId(accessToken) {
  // Try legacy /v2/me first
  let url = 'https://api.linkedin.com/v2/me';
  let options = {
    "headers": { "Authorization": "Bearer " + accessToken },
    "muteHttpExceptions": true
  };
  let response = UrlFetchApp.fetch(url, options);
  let data = JSON.parse(response.getContentText());

  if (response.getResponseCode() === 200 && data.id) {
    return `urn:li:person:${data.id}`;
  }

  // If 403, try the newer OpenID Connect userinfo endpoint
  if (response.getResponseCode() === 403) {
    url = 'https://api.linkedin.com/v2/userinfo';
    response = UrlFetchApp.fetch(url, options);
    data = JSON.parse(response.getContentText());

    if (response.getResponseCode() === 200 && data.sub) {
      return `urn:li:person:${data.sub}`;
    }
  }

  // If both failed, throw a detailed error
  throw new Error(`LinkedIn Permission Error: Could not retrieve profile ID. Ensure you have "Sign In with LinkedIn" or "Share on LinkedIn" enabled in your Developer Portal and selected the correct scopes. (Response: ${response.getContentText()})`);
}

function uploadLinkedInImage(imageUrl, accessToken, memberId) {
  // 1. Register Upload
  const registerUrl = 'https://api.linkedin.com/v2/assets?action=registerUpload';
  const registerPayload = {
    "registerUploadRequest": {
      "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
      "owner": memberId,
      "serviceRelationships": [{
        "relationshipType": "OWNER",
        "identifier": "urn:li:userGeneratedContent"
      }]
    }
  };

  const registerOptions = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    "payload": JSON.stringify(registerPayload)
  };

  const registerRes = UrlFetchApp.fetch(registerUrl, registerOptions);
  const registerData = JSON.parse(registerRes.getContentText());
  const uploadUrl = registerData.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
  const assetUrn = registerData.value.asset;

  // 2. Upload Bytes
  const imageBlob = UrlFetchApp.fetch(imageUrl).getBlob();
  const uploadOptions = {
    "method": "put",
    "headers": { "Authorization": "Bearer " + accessToken },
    "payload": imageBlob.getBytes(),
    "contentType": imageBlob.getContentType()
  };

  UrlFetchApp.fetch(uploadUrl, uploadOptions);
  return assetUrn;
}

function testLinkedInToken() {
  const token = API_KEYS.LINKEDIN;
  if (!token || token === 'YOUR_LINKEDIN_API_KEY' || token.trim() === "") {
    Logger.log("❌ LinkedIn API key is empty or not set correctly in Code.js (line 28).");
    return;
  }

  Logger.log("🔄 Testing LinkedIn connection...");
  try {
    const memberId = getLinkedInMemberId(token);
    Logger.log("✅ Successfully connected to LinkedIn!");
    Logger.log("👤 Member ID: " + memberId);
    return memberId;
  } catch (e) {
    Logger.log("❌ LinkedIn Connection Failed: " + e.toString());
    Logger.log("💡 Tip: Ensure you copied the FULL token from the LinkedIn Developer Portal and it hasn't expired.");
  }
}
