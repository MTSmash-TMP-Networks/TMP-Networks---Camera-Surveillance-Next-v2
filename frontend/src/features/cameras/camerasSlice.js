import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api } from '../../services/api.js';
export const loadCameras = createAsyncThunk('cameras/load', async () => (await api.cameras()).items);
const slice = createSlice({
  name: 'cameras', initialState: { items: [], status: 'idle', error: null }, reducers: {
    cameraUpserted(state, action) {
      const camera = action.payload;
      if (!camera?.id) return;
      const index = state.items.findIndex((item) => item.id === camera.id);
      if (index >= 0) state.items[index] = camera;
      else state.items.push(camera);
      state.items.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'de'));
      state.status = 'ready';
      state.error = null;
    },
  },
  extraReducers: (builder) => builder
    .addCase(loadCameras.pending, (state) => { state.status = 'loading'; })
    .addCase(loadCameras.fulfilled, (state, action) => { state.status = 'ready'; state.items = action.payload; state.error = null; })
    .addCase(loadCameras.rejected, (state, action) => { state.status = 'error'; state.error = action.error.message; }),
});
export const { cameraUpserted } = slice.actions;
export default slice.reducer;
