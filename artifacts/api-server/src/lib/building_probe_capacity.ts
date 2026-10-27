export const CAPACITY_WINDOW_BYTES = 10_000_000_000;
export function remainingCapacity(validated:number,reserved:number) {
  if(!Number.isSafeInteger(validated)||!Number.isSafeInteger(reserved)||validated<0||reserved<0||validated+reserved>CAPACITY_WINDOW_BYTES)throw new Error('Invalid capacity ledger.');
  return CAPACITY_WINDOW_BYTES-validated-reserved;
}
export function capacityDeadline(firstDispatchAt:string|Date,admissionEnd:string|Date) {
  return new Date(Math.min(new Date(firstDispatchAt).getTime()+900000,new Date(admissionEnd).getTime()+900000));
}
export function terminalCapacityBytes(result:any,reservation:number) {
  const bytes=result.details?.bytes;
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>reservation)return null;
  // Missing terminal accounting can never grant permission for another transfer.
  if(result.details.bytesAccounted===true)return bytes;
  if(result.outcome==='completed'&&result.details.termination==='byte_budget'&&bytes===reservation)return bytes;
  return null;
}
