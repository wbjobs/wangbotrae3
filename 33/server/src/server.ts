import express from 'express';
import cors from 'cors';
import {
  getAllSamples,
  getSampleById,
  getSamplesByDeviceId,
  bulkUpsertSamples
} from './database';
import { exportToExcel, exportToGeoJSON, filterSamples } from './exportService';
import { SyncRequest, SyncResponse, ExportOptions } from '../../shared/types';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/samples', (req, res) => {
  const deviceId = req.query.deviceId as string;
  let samples;
  if (deviceId) {
    samples = getSamplesByDeviceId(deviceId);
  } else {
    samples = getAllSamples();
  }
  res.json(samples);
});

app.get('/api/samples/:id', (req, res) => {
  const sample = getSampleById(req.params.id);
  if (!sample) {
    return res.status(404).json({ error: 'Sample not found' });
  }
  res.json(sample);
});

app.post('/api/sync', (req, res) => {
  const body = req.body as SyncRequest;
  
  if (!body.deviceId || !body.samples) {
    return res.status(400).json({ error: 'Invalid sync request' });
  }

  const { updated, conflicts } = bulkUpsertSamples(body.samples);
  const serverSamples = getSamplesByDeviceId(body.deviceId);

  const response: SyncResponse = {
    success: true,
    message: `Synced ${updated.length} samples`,
    serverSamples,
    updatedSampleIds: updated,
    conflicts,
    syncTimestamp: Date.now()
  };

  res.json(response);
});

app.post('/api/export/excel', async (req, res) => {
  const options: ExportOptions = req.body;
  const allSamples = getAllSamples();
  const filtered = filterSamples(allSamples, options);

  try {
    const buffer = await exportToExcel(filtered);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="geology-samples-${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

app.post('/api/export/geojson', (req, res) => {
  const options: ExportOptions = req.body;
  const allSamples = getAllSamples();
  const filtered = filterSamples(allSamples, options);

  const geojson = exportToGeoJSON(filtered);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="geology-samples-${Date.now()}.geojson"`);
  res.send(geojson);
});

app.listen(PORT, () => {
  console.log(`Geology Sync Server running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
});
