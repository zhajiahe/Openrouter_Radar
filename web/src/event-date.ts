/** Event aggregation uses UTC calendar days; detail filters must use the same boundary. */
export function utcEventBounds(date:string):{start:number;end:number}|null{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const start=Date.parse(date+'T00:00:00.000Z');
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==date)return null;
 const seconds=Math.floor(start/1000);
 return {start:seconds,end:seconds+86400-1};
}
