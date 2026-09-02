import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../features/auth/authSlice.js';
import camerasReducer from '../features/cameras/camerasSlice.js';
export const store = configureStore({ reducer: { auth: authReducer, cameras: camerasReducer } });
