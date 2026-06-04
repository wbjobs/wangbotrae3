import { GeoLocation } from '@shared/types';

export async function getCurrentPosition(): Promise<GeoLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('浏览器不支持地理定位'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude || undefined
        });
      },
      (error) => {
        let message = '获取位置失败';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = '位置权限被拒绝';
            break;
          case error.POSITION_UNAVAILABLE:
            message = '位置信息不可用';
            break;
          case error.TIMEOUT:
            message = '获取位置超时';
            break;
        }
        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

export function watchPosition(
  callback: (location: GeoLocation) => void,
  errorCallback?: (error: Error) => void
): number {
  if (!navigator.geolocation) {
    errorCallback?.(new Error('浏览器不支持地理定位'));
    return -1;
  }

  return navigator.geolocation.watchPosition(
    (position) => {
      callback({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude || undefined
      });
    },
    (error) => {
      let message = '获取位置失败';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = '位置权限被拒绝';
          break;
        case error.POSITION_UNAVAILABLE:
          message = '位置信息不可用';
          break;
        case error.TIMEOUT:
          message = '获取位置超时';
          break;
      }
      errorCallback?.(new Error(message));
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

export function clearWatch(watchId: number): void {
  if (watchId >= 0 && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
}
