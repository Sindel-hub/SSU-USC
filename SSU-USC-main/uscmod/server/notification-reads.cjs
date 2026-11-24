"use strict";
const { createHash } = require('node:crypto');
const { ServiceError } = require('./settings.cjs');
function createNotificationReadHandlers({db,requireActiveRole,clock=Date.now}) {
  async function owner(request) {
    await requireActiveRole(request,['student','officer','admin']);
    return db.collection(`notification_reads/${request.auth.uid}/items`);
  }
  return {
    async notificationReadList(request) {
      let q=await owner(request);
      const after=request.data?.after;
      if(after!==undefined&&after!==null&&!/^[a-f0-9]{64}$/.test(after))throw new ServiceError('invalid-argument','Invalid read-state cursor.');
      q=q.orderBy('__name__').limit(201);if(after)q=q.startAfter(after);
      const docs=(await q.get()).docs;
      return {ids:docs.slice(0,200).map(d=>d.data().notificationId),next:docs.length>200?docs[199].id:null};
    },
    async notificationReadMark(request) {
      const collection=await owner(request),ids=request.data?.ids;
      if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>typeof id!=='string'||id.length>512||!/^(announcement|event|program|complaint):[^/\u0000-\u001f]+$/.test(id)))throw new ServiceError('invalid-argument','Choose up to 100 valid notifications.');
      const unique=[...new Set(ids)];
      await db.runTransaction(async tx=>{for(const notificationId of unique)tx.set(collection.doc(createHash('sha256').update(notificationId).digest('hex')),{notificationId,readAtMs:clock()});});
      return {ids:unique};
    }
  };
}
module.exports={createNotificationReadHandlers};
