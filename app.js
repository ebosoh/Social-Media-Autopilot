const { createApp, ref, computed, onMounted } = Vue;

// ============================================================================
// CONFIGURATION
// ============================================================================

// [PLACEHOLDER_REQUIRED]: Replace with your deployed Google Apps Script Web App URL.
// When this is set, the app automatically switches to "hosted mode":
//   - Google Sign-In is shown instead of the password form
//   - User management reads from and writes to the Google Sheet
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbweeejykNU4B8fWCRifuvPRfMtKa1kAq9qqrqddqHZyID7h8YzYSi1Aa9RIwSZLYOlZYw/exec";

// [PLACEHOLDER_REQUIRED]: Replace with your Google OAuth 2.0 Client ID.
// Create one at: https://console.cloud.google.com/ > APIs & Services > Credentials
// The "Authorized JavaScript origins" must include your GitHub Pages domain.
const GOOGLE_CLIENT_ID = "465287709316-85racf46nbmec2oqt98cuoeo68ucru2s.apps.googleusercontent.com";

// Determines if the app is running against a real hosted backend
const IS_HOSTED = !WEB_APP_URL.includes('YOUR_DEPLOYMENT_ID');

// ============================================================================
// LOCAL AUTH CONFIG (used only when IS_HOSTED = false, i.e. during local preview)
// [PLACEHOLDER_REQUIRED]: Update these for local testing. These credentials are
// NOT used in production — on the hosted backend, Google Sign-In handles auth.
// ============================================================================
const LOCAL_USERS = [
    { email: "admin@yourbrand.com", password: "ChangeMe123!" },
];

const SESSION_KEY = "autopilot_session";

// ============================================================================
// GLOBAL GOOGLE SIGN-IN CALLBACK
// Must be in window scope for Google Identity Services to call it.
// ============================================================================
window.onGoogleSignIn = function (credentialResponse) {
    // This is called by Google after the user selects their account.
    // We pass the ID token to the Vue app instance via a custom event.
    window.dispatchEvent(new CustomEvent('google-signin', { detail: credentialResponse }));
};

// ============================================================================
// VUE APP
// ============================================================================
createApp({
    setup() {

        // ── Auth State ────────────────────────────────────────────────────────
        const isAuthenticated = ref(false);
        const loginEmail = ref("");
        const loginPassword = ref("");
        const showPassword = ref(false);
        const loginError = ref("");
        const isLoggingIn = ref(false);
        const googleIdToken = ref(null); // Google ID token, used in API calls

        // ── User Management State ─────────────────────────────────────────────
        const showUserModal = ref(false);
        const allowedUsers = ref([]);
        const isLoadingUsers = ref(false);
        const newUserEmail = ref("");
        const newUserName = ref("");
        const newUserRole = ref("viewer");
        const isAddingUser = ref(false);
        const userModalError = ref("");

        // ── Dashboard State ───────────────────────────────────────────────────
        const queue = ref([]);
        const isLoading = ref(false);
        const isTriggering = ref(false);
        const searchQuery = ref("");

        // ── Constants exposed to template ─────────────────────────────────────
        const isHosted = IS_HOSTED;
        const GOOGLE_CLIENT_ID_EXPOSED = GOOGLE_CLIENT_ID;

        // ── Computed ──────────────────────────────────────────────────────────
        const userInitials = computed(() => {
            if (!loginEmail.value) return "?";
            const parts = loginEmail.value.split("@")[0].split(/[._-]/);
            return parts.slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("");
        });

        const filteredQueue = computed(() => {
            if (!searchQuery.value) return queue.value;
            const query = searchQuery.value.toLowerCase();
            return queue.value.filter(post =>
                post.Topic.toLowerCase().includes(query) ||
                post.Post_Text.toLowerCase().includes(query)
            );
        });

        const pendingCount = computed(() => queue.value.filter(p => p.Status === 'Draft').length);

        // ── Auth Methods ──────────────────────────────────────────────────────

        /**
         * Handles the Google Sign-In callback from Google Identity Services.
         * Validates the email against the Sheet's Allowed_Users list via the backend.
         */
        const handleGoogleResponse = async (credentialResponse) => {
            isLoggingIn.value = true;
            loginError.value = "";
            try {
                // Decode the JWT to get the email (client-side, no secret needed for display)
                const payload = JSON.parse(atob(credentialResponse.credential.split('.')[1]));
                const email = payload.email;

                // Validate against Allowed_Users on the backend
                const res = await fetch(WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'checkUser', idToken: credentialResponse.credential })
                });
                const result = await res.json();

                if (result.allowed) {
                    googleIdToken.value = credentialResponse.credential;
                    loginEmail.value = email;
                    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email, idToken: credentialResponse.credential }));
                    isAuthenticated.value = true;
                    fetchData();
                } else {
                    loginError.value = result.error || "Your Google account is not authorised to access this dashboard.";
                }
            } catch (err) {
                loginError.value = "Google Sign-In failed. Try again.";
                console.error(err);
            } finally {
                isLoggingIn.value = false;
            }
        };

        /**
         * Handles manual email+password login (local preview mode only).
         * In hosted mode, only the email is checked in the local list as a fallback
         * since the real gate is the Google token validated server-side.
         */
        const handleLogin = async () => {
            loginError.value = "";
            if (!loginEmail.value) {
                loginError.value = "Please enter your email.";
                return;
            }
            if (!IS_HOSTED && !loginPassword.value) {
                loginError.value = "Please enter your password.";
                return;
            }
            isLoggingIn.value = true;

            await new Promise(r => setTimeout(r, 600));

            if (!IS_HOSTED) {
                // Local preview: check against LOCAL_USERS
                const match = LOCAL_USERS.find(
                    u => u.email.toLowerCase() === loginEmail.value.toLowerCase().trim()
                        && u.password === loginPassword.value
                );
                if (match) {
                    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: loginEmail.value }));
                    isAuthenticated.value = true;
                    loginPassword.value = "";
                    fetchData();
                } else {
                    loginError.value = "Incorrect email or password. Please try again.";
                }
            } else {
                // Hosted mode: cannot log in without Google. Show helpful message.
                loginError.value = "Please use the 'Sign in with Google' button above to authenticate.";
            }

            isLoggingIn.value = false;
        };

        const handleLogout = () => {
            sessionStorage.removeItem(SESSION_KEY);
            isAuthenticated.value = false;
            googleIdToken.value = null;
            queue.value = [];
            loginEmail.value = "";
            loginPassword.value = "";
            loginError.value = "";
        };

        const restoreSession = () => {
            try {
                const raw = sessionStorage.getItem(SESSION_KEY);
                if (raw) {
                    const session = JSON.parse(raw);
                    loginEmail.value = session.email || "";
                    googleIdToken.value = session.idToken || null;
                    isAuthenticated.value = true;
                }
            } catch (e) {
                sessionStorage.removeItem(SESSION_KEY);
            }
        };

        // ── User Management ───────────────────────────────────────────────────

        const openUserModal = async () => {
            showUserModal.value = true;
            userModalError.value = "";
            await fetchUsers();
        };

        const fetchUsers = async () => {
            isLoadingUsers.value = true;
            try {
                if (!IS_HOSTED) {
                    // Local dummy
                    allowedUsers.value = LOCAL_USERS.map((u, i) => ({
                        _rowNum: i + 2,
                        Email: u.email,
                        Name: 'Local User',
                        Role: 'admin',
                        Added_Date: new Date().toISOString()
                    }));
                    return;
                }
                const res = await fetch(`${WEB_APP_URL}?action=getUsers`);
                const result = await res.json();
                allowedUsers.value = result.users || [];
            } catch (err) {
                userModalError.value = "Failed to load users.";
            } finally {
                isLoadingUsers.value = false;
            }
        };

        const addUser = async () => {
            userModalError.value = "";
            if (!newUserEmail.value) {
                userModalError.value = "Please enter an email.";
                return;
            }
            isAddingUser.value = true;
            try {
                if (!IS_HOSTED) {
                    // Simulate locally
                    await new Promise(r => setTimeout(r, 600));
                    allowedUsers.value.push({
                        _rowNum: allowedUsers.value.length + 2,
                        Email: newUserEmail.value,
                        Name: newUserName.value,
                        Role: newUserRole.value,
                        Added_Date: new Date().toISOString()
                    });
                    newUserEmail.value = ""; newUserName.value = ""; newUserRole.value = "viewer";
                    return;
                }
                const res = await fetch(WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'addUser',
                        idToken: googleIdToken.value,
                        email: newUserEmail.value,
                        name: newUserName.value,
                        role: newUserRole.value
                    })
                });
                const result = await res.json();
                if (result.success) {
                    newUserEmail.value = ""; newUserName.value = ""; newUserRole.value = "viewer";
                    await fetchUsers();
                } else {
                    userModalError.value = result.message || "Could not add user.";
                }
            } catch (err) {
                userModalError.value = "Failed to add user.";
            } finally {
                isAddingUser.value = false;
            }
        };

        const removeUser = async (user) => {
            if (!confirm(`Remove ${user.Email} from allowed users?`)) return;
            try {
                if (!IS_HOSTED) {
                    allowedUsers.value = allowedUsers.value.filter(u => u._rowNum !== user._rowNum);
                    return;
                }
                await fetch(WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'removeUser', idToken: googleIdToken.value, rowNum: user._rowNum })
                });
                await fetchUsers();
            } catch (err) {
                userModalError.value = "Failed to remove user.";
            }
        };

        // ── Content Data ──────────────────────────────────────────────────────

        const dummyData = [
            { _rowNum: 2, Topic: "AI in Dentistry 2026", Post_Text: "Embracing tomorrow, today. How AI is transforming patient care. Swipe to learn more! #TechBrain #AI", Image_URL: "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&q=80&w=800", Platform: "LinkedIn", Status: "Draft", Timestamp: new Date().toISOString() },
            { _rowNum: 3, Topic: "Team Culture & Community", Post_Text: "Behind every great clinic is a team that treats each other like family. Meet our crew!", Image_URL: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&q=80&w=800", Platform: "Instagram", Status: "Approved_Scheduled", Timestamp: new Date(Date.now() - 86400000).toISOString() },
            { _rowNum: 4, Topic: "Quick Tips: Flossing", Post_Text: "Quick Tip: Flossing daily does more than protect your teeth, it protects your heart!", Image_URL: "", Platform: "X(Twitter)", Status: "Draft", Timestamp: new Date().toISOString() },
            { _rowNum: 5, Topic: "TikTok Trends in Healthcare", Post_Text: "Healthcare is going viral! Here are the top TikTok trends shaking up the wellness space.", Image_URL: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&q=80&w=800", Platform: "Tiktok", Status: "Draft", Timestamp: new Date().toISOString() },
            { _rowNum: 6, Topic: "Brand Spotlight", Post_Text: "We believe in transparent, compassionate care. Check out what our patients are saying!", Image_URL: "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?auto=format&fit=crop&q=80&w=800", Platform: "Facebook", Status: "Posted", Timestamp: new Date(Date.now() - 172800000).toISOString() }
        ];

        const fetchData = async () => {
            isLoading.value = true;
            try {
                if (!IS_HOSTED) {
                    queue.value = dummyData.map(p => ({ ...p, isApproving: false }));
                    setTimeout(() => { isLoading.value = false; }, 800);
                    return;
                }
                const res = await fetch(`${WEB_APP_URL}?action=getData`);
                const result = await res.json();
                if (result.data) queue.value = result.data.map(p => ({ ...p, isApproving: false })).reverse();
            } catch (err) {
                alert("Failed to connect to Google Sheets DB.");
            } finally {
                isLoading.value = false;
            }
        };

        const approvePost = async (post) => {
            post.isApproving = true;
            try {
                if (!IS_HOSTED) {
                    await new Promise(r => setTimeout(r, 1000));
                    post.Status = 'Approved_Scheduled';
                    return;
                }
                const res = await fetch(WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'approvePost', idToken: googleIdToken.value, rowNum: post._rowNum }) });
                const result = await res.json();
                if (result.success) post.Status = 'Approved_Scheduled';
            } catch { alert("Failed to approve post."); }
            finally { post.isApproving = false; }
        };

        const triggerResearch = async () => {
            isTriggering.value = true;
            try {
                if (!IS_HOSTED) {
                    await new Promise(r => setTimeout(r, 1500));
                    alert("Research Loop triggered (Simulation)");
                    return;
                }
                const res = await fetch(WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'triggerResearch', idToken: googleIdToken.value }) });
                const result = await res.json();
                if (result.success) { alert("Research Agent triggered!"); fetchData(); }
            } catch { alert("Failed to trigger agent."); }
            finally { isTriggering.value = false; }
        };

        // ── Utilities ─────────────────────────────────────────────────────────
        const truncateText = (text, len) => !text ? "" : text.length <= len ? text : text.substring(0, len) + '...';
        const formatDate = (ds) => !ds ? "" : new Date(ds).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const handleImageError = (e) => { e.target.src = "https://images.unsplash.com/photo-1616469829581-73993eb86b02?auto=format&fit=crop&q=80&w=800"; };
        const getPlatformIcon = (p) => {
            if (!p) return 'share-network';
            const s = p.toLowerCase();
            if (s.includes('linkedin')) return 'linkedin-logo';
            if (s.includes('twitter') || s.includes('x')) return 'twitter-logo';
            if (s.includes('instagram')) return 'instagram-logo';
            if (s.includes('facebook')) return 'facebook-logo';
            if (s.includes('tiktok')) return 'tiktok-logo';
            return 'share-network';
        };

        // ── Lifecycle ─────────────────────────────────────────────────────────
        onMounted(() => {
            restoreSession();
            if (isAuthenticated.value) fetchData();

            // Listen for Google Sign-In callback
            window.addEventListener('google-signin', (e) => {
                handleGoogleResponse(e.detail);
            });
        });

        return {
            // Auth
            isAuthenticated, isHosted, loginEmail, loginPassword, showPassword,
            loginError, isLoggingIn, userInitials, googleIdToken,
            GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID_EXPOSED,
            handleLogin, handleLogout,
            // User Management
            showUserModal, allowedUsers, isLoadingUsers,
            newUserEmail, newUserName, newUserRole, isAddingUser, userModalError,
            openUserModal, addUser, removeUser,
            // Dashboard
            queue, isLoading, isTriggering, searchQuery,
            filteredQueue, pendingCount,
            fetchData, approvePost, triggerResearch,
            truncateText, formatDate, getPlatformIcon, handleImageError
        };
    }
}).mount('#app');
