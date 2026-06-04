import * as ExcelJS from 'exceljs';
import { SamplePoint, ROCK_TYPE_LABELS, ExportOptions } from '../../shared/types';

export async function exportToExcel(samples: SamplePoint[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('采样点数据');

  worksheet.columns = [
    { header: '采样编号', key: 'sampleNumber', width: 15 },
    { header: '岩石类型', key: 'rockType', width: 12 },
    { header: '纬度', key: 'latitude', width: 15 },
    { header: '经度', key: 'longitude', width: 15 },
    { header: '海拔(m)', key: 'altitude', width: 12 },
    { header: '描述', key: 'description', width: 30 },
    { header: '照片数量', key: 'photoCount', width: 10 },
    { header: '创建时间', key: 'createdAt', width: 20 },
    { header: '设备ID', key: 'deviceId', width: 20 }
  ];

  worksheet.getRow(1).font = { bold: true };

  samples.forEach(sample => {
    worksheet.addRow({
      sampleNumber: sample.sampleNumber,
      rockType: ROCK_TYPE_LABELS[sample.rockType] || sample.rockType,
      latitude: sample.location.latitude,
      longitude: sample.location.longitude,
      altitude: sample.location.altitude || '-',
      description: sample.description || '',
      photoCount: sample.photos.length,
      createdAt: new Date(sample.createdAt).toLocaleString('zh-CN'),
      deviceId: sample.deviceId
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportToGeoJSON(samples: SamplePoint[]): string {
  const features = samples.map(sample => ({
    type: 'Feature',
    properties: {
      id: sample.id,
      sampleNumber: sample.sampleNumber,
      rockType: sample.rockType,
      rockTypeLabel: ROCK_TYPE_LABELS[sample.rockType] || sample.rockType,
      description: sample.description || '',
      photoCount: sample.photos.length,
      createdAt: new Date(sample.createdAt).toISOString(),
      deviceId: sample.deviceId,
      altitude: sample.location.altitude || null
    },
    geometry: {
      type: 'Point',
      coordinates: [sample.location.longitude, sample.location.latitude]
    }
  }));

  const geojson = {
    type: 'FeatureCollection',
    name: 'geology-sample-points',
    crs: {
      type: 'name',
      properties: {
        name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
      }
    },
    features
  };

  return JSON.stringify(geojson, null, 2);
}

export function filterSamples(samples: SamplePoint[], options: ExportOptions): SamplePoint[] {
  return samples.filter(sample => {
    if (options.startDate && sample.createdAt < options.startDate) {
      return false;
    }
    if (options.endDate && sample.createdAt > options.endDate) {
      return false;
    }
    if (options.sampleIds && options.sampleIds.length > 0) {
      return options.sampleIds.includes(sample.id);
    }
    return true;
  });
}
