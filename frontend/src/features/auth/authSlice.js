import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api, setAccessToken, enrollDesktopSession, isDesktopKiosk, renewDesktopSession } from '../../services/api.js';

export const loadRuntime = createAsyncThunk('auth/runtime', async () => api.runtime());
export const login = createAsyncThunk('auth/login', async ({ username, password, rememberDevice = false }) => isDesktopKiosk() && rememberDevice
  ? enrollDesktopSession(username, password)
  : api.login(username, password));
export const restoreDesktopSession = createAsyncThunk('auth/desktopRestore', async (_, { rejectWithValue }) => {
  try { return await renewDesktopSession(); }
  catch (error) { return rejectWithValue({ status: Number(error?.status || 0) }); }
});
export const restoreSession = createAsyncThunk('auth/restore', async () => api.me());

const slice = createSlice({
  name: 'auth',
  initialState: { user: null, token: (() => { try { return sessionStorage.getItem('tmp_camera_token'); } catch { return null; } })(), status: 'idle', desktopRestoring: isDesktopKiosk(), desktopOffline: false, error: null, runtime: { demoMode: false, readOnly: false, allowExports: false, version: null } },
  reducers: {
    logout(state) { state.user = null; state.token = null; state.desktopOffline = false; setAccessToken(''); },
    sessionUpdated(state, action) {
      if (action.payload?.user) state.user = action.payload.user;
      if (action.payload?.token) {
        state.token = action.payload.token;
        setAccessToken(action.payload.token);
      }
    },
  },
  extraReducers: (builder) => builder
    .addCase(login.pending, (state) => { state.status = 'loading'; state.error = null; })
    .addCase(login.fulfilled, (state, action) => { state.status = 'ready'; state.user = action.payload.user; state.token = action.payload.token; state.runtime = action.payload.runtime || state.runtime; setAccessToken(action.payload.token); })
    .addCase(login.rejected, (state, action) => { state.status = 'error'; state.error = action.error.message; })
    .addCase(restoreDesktopSession.pending, (state) => { if (!state.user) state.desktopRestoring = true; })
    .addCase(restoreDesktopSession.fulfilled, (state, action) => {
      state.desktopRestoring = false;
      state.desktopOffline = false;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.runtime = action.payload.runtime || state.runtime;
      state.status = 'ready';
      setAccessToken(action.payload.token);
    })
    .addCase(restoreDesktopSession.rejected, (state, action) => {
      state.desktopRestoring = false;
      state.desktopOffline = !action.payload?.status;
      // A network outage is temporary. Do not discard a valid device grant.
      // A 401 is an explicit server-side revocation or expiration.
      if (action.payload?.status === 401) {
        state.user = null; state.token = null; state.status = 'idle'; setAccessToken('');
      }
    })
    .addCase(restoreSession.fulfilled, (state, action) => { state.user = action.payload.user; state.runtime = action.payload.runtime || state.runtime; state.status = 'ready'; })
    .addCase(loadRuntime.fulfilled, (state, action) => { state.runtime = action.payload || state.runtime; })
    .addCase(restoreSession.rejected, (state) => { state.user = null; state.token = null; state.status = 'idle'; setAccessToken(''); }),
});
export const { logout, sessionUpdated } = slice.actions;
export default slice.reducer;
