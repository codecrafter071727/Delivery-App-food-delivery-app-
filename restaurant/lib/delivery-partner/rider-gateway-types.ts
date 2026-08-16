export type RiderGatewayEvent =
  | 'delivery:new'
  | 'delivery:assigned'
  | 'delivery:assignment-expiring'
  | 'delivery:cancelled'
  | 'delivery:updated'
  | 'delivery:status'
  | 'notification:new'
  | 'earnings:updated'
  | 'wallet:credited'
  | 'chat:new-message'
  | 'typing'
  | 'partner:location'
  | 'tracking:location'
  | 'tracking:eta';

export type RiderGatewayStatus = 'idle' | 'connecting' | 'connected' | 'offline';

export type RiderLocationEmit = {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
};
