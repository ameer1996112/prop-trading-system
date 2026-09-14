#ifndef TRADEOPS_JOURNAL_COLLECTOR_MQH
#define TRADEOPS_JOURNAL_COLLECTOR_MQH
#include "TradeOpsCaptureStateCodec.mqh"
#include "TradeOpsAccountSnapshot.mqh"

class CTov2JournalCollector
{
private:
   bool m_ready,m_stopped,m_restart,m_dirty_gap;
   int m_dirty;
   string m_error;

   int Stop(const int result,const string error)
   {m_stopped=true;m_error=error;return result;}

   int Context(CTov2TelemetryState *state,Tov2LocalState &local,string &root,
               Tov2CaptureCheckpoint &capture,Tov2CaptureRegistration &registration)
   {
      Tov2LocalClearState(local);root="";Tov2CaptureCheckpointClear(capture);ZeroMemory(registration);
      if(CheckPointer(state)==POINTER_INVALID) return TOV2_STATE_INVALID;
      uchar reg[],bytes[];
      int read=state.ReadCaptureContext(local,root,reg,bytes);
      if(read!=TOV2_STATE_OK) return read;
      if(!Tov2CaptureCheckpointDecode(bytes,capture) ||
         !Tov2CaptureContextMatches(local,reg,capture,registration))
      {
         Tov2LocalClearState(local);root="";Tov2CaptureCheckpointClear(capture);ZeroMemory(registration);
         return TOV2_STATE_RECOVERY_REQUIRED;
      }
      return TOV2_STATE_OK;
   }

   bool SameIdentity(ITov2CaptureBroker *broker,const Tov2CaptureRegistration &registration)
   {
      string fingerprint="";Tov2CaptureDisplay display;
      if(broker.Identity(fingerprint,display)!=TOV2_CAPTURE_OK || !Tov2CaptureDisplayValid(display))
      {m_error="CAPTURE_FAILED";return false;}
      if(fingerprint!=registration.boundary.account_fingerprint_sha256 ||
         display.currency!=registration.display.currency || display.currency_scale!=registration.display.currency_scale)
      {m_error="IDENTITY_MISMATCH";m_stopped=true;return false;}
      return true;
   }

   void SortCheckpoint(Tov2CaptureCheckpoint &c)
   {
      for(int i=1;i<c.revision_count;i++)
      {
         Tov2CaptureRevision row=c.revisions[i];int j=i-1;
         while(j>=0 && StringCompare(c.revisions[j].ticket,row.ticket)>0)
         {c.revisions[j+1]=c.revisions[j];j--;}
         c.revisions[j+1]=row;
      }
      for(int i=1;i<c.protection_count;i++)
      {
         Tov2CaptureProtectionIndex row=c.protections[i];int j=i-1;
         while(j>=0 && StringCompare(c.protections[j].position_id,row.position_id)>0)
         {c.protections[j+1]=c.protections[j];j--;}
         c.protections[j+1]=row;
      }
   }

   void PurgeAcknowledged(Tov2CaptureCheckpoint &c,const long accepted)
   {
      int count=0;
      for(int i=0;i<c.queue_count;i++) if(c.queued[i].sequence>accepted) c.queued[count++]=c.queued[i];
      for(int i=count;i<c.queue_count;i++) ZeroMemory(c.queued[i]);
      c.queue_count=count;
   }

   int Publish(CTov2TelemetryState *state,const string root,Tov2CaptureCheckpoint &next,
               const Tov2AppendCandidate &events[],const uchar &arena[],const int &ends[],
               const bool diagnostic=false)
   {
      SortCheckpoint(next);
      uchar bytes[];
      if(!Tov2CaptureCheckpointEncode(next,bytes) ||
         (!diagnostic && ArraySize(bytes)>TOV2_CAPTURE_JSON_MAX-TOV2_CAPTURE_DIAGNOSTIC_RESERVE))
         return TOV2_STATE_LIMIT;
      Tov2LocalState current;string actual="";uchar registration[],capture[];
      int read=state.ReadCaptureContext(current,actual,registration,capture);
      if(read!=TOV2_STATE_OK) return read;
      if(actual!=root || current.produced+ArraySize(events)!=next.produced) return TOV2_STATE_CONFLICT;
      long sequences[];
      return state.Append(events,arena,ends,bytes,TOV2_CAPTURE_SCHEMA,sequences);
   }

   int PersistGap(CTov2TelemetryState *state,const string root,const Tov2CaptureCheckpoint &prior,
                  const string gap,const bool observation,const bool stop=false)
   {
      Tov2CaptureCheckpoint diagnostic=prior;
      if(!diagnostic.quarantine) diagnostic.record_gap=gap;
      diagnostic.observation_gap=diagnostic.observation_gap || observation;
      diagnostic.scan_finished=false;
      Tov2AppendCandidate none[];uchar arena[];int ends[];
      int result=Publish(state,root,diagnostic,none,arena,ends,true);
      if(result!=TOV2_STATE_OK) return Stop(result,"PERSISTENCE_ERROR");
      m_error=gap;
      if(stop) m_stopped=true;
      return stop?TOV2_STATE_LIMIT:TOV2_STATE_OK;
   }

   bool StageRecord(Tov2CaptureCheckpoint &c,const string json,const string deal_id,
                    const long revision,const long observed,Tov2AppendCandidate &events[],
                    uchar &arena[],int &ends[])
   {
      int count=ArraySize(events),offset=ArraySize(arena);
      if(count>=TOV2_LOCAL_BATCH || c.produced>=TOV2_LOCAL_MAX_COUNTER ||
         c.queue_count>=TOV2_CAPTURE_QUEUE_MAX) return false;
      uchar payload[];string sha="",identity_sha="";
      if(!Tov2CaptureUtf8Bytes(json,payload) || !Tov2LocalHash(payload,sha) ||
         !Tov2CaptureRecordHash(c.identity,identity_sha)) return false;
      // Identity digest plus exact decimal sequence and record digest; no floating point identifiers.
      string id="cap."+StringSubstr(identity_sha,0,32)+"."+Tov2LocalNumber(c.produced+1)+"."+sha;
      int size=ArraySize(payload);
      if(!Tov2Identifier(id) || ArrayResize(events,count+1)!=count+1 ||
         ArrayResize(ends,count+1)!=count+1 || ArrayResize(arena,offset+size)!=offset+size ||
         ArrayCopy(arena,payload,offset,0,size)!=size) return false;
      events[count].event_id=id;events[count].record_sha=sha;events[count].deal_id=deal_id;
      events[count].revision=revision;ends[count]=offset+size;
      c.produced++;
      c.queued[c.queue_count].sequence=c.produced;c.queued[c.queue_count].event_id=id;
      c.queued[c.queue_count].record_sha=sha;c.queued[c.queue_count].observed_utc=observed;
      c.queue_count++;return true;
   }

   int ProtectionChanges(const Tov2CaptureCheckpoint &c,const Tov2CaptureExposure &sample)
   {
      int count=0;
      for(int i=0;i<sample.positions_size;i++)
      {
         string sha="";int index=Tov2CaptureFindProtection(c,sample.positions[i].position_id);
         if(!Tov2CaptureProtectionContent(sample.positions[i],sha)) return -1;
         if(index<0 || c.protections[index].content_sha!=sha) count++;
      }
      return count;
   }

   void PruneProtectionCache(Tov2CaptureCheckpoint &c,const Tov2CaptureExposure &sample)
   {
      int count=0;
      for(int i=0;i<c.protection_count;i++)
      {
         bool present=false;
         for(int j=0;j<sample.positions_size;j++)
            if(sample.positions[j].position_id==c.protections[i].position_id) present=true;
         if(present) c.protections[count++]=c.protections[i];
      }
      for(int i=count;i<c.protection_count;i++) ZeroMemory(c.protections[i]);
      c.protection_count=count;
   }

   bool StageProtections(Tov2CaptureCheckpoint &c,const Tov2CaptureExposure &sample,const int budget,
                         Tov2AppendCandidate &events[],uchar &arena[],int &ends[])
   {
      int added=0;
      PruneProtectionCache(c,sample);
      for(int i=0;i<sample.positions_size && added<budget;i++)
      {
         string sha="",json="";Tov2CaptureProtection p;
         if(!Tov2CaptureProtectionContent(sample.positions[i],sha)) return false;
         int index=Tov2CaptureFindProtection(c,sample.positions[i].position_id);
         if(index>=0 && c.protections[index].content_sha==sha) continue;
         Tov2CaptureProtectionFacts(sample.positions[i],sample.observed_at_broker_msc,p);
         if(!Tov2CaptureEncodeProtection(p,json) ||
            !StageRecord(c,json,"-",0,sample.observed_at_utc_seconds,events,arena,ends)) return false;
         if(index<0)
         {
            if(c.protection_count>=TOV2_CAPTURE_POSITIONS_MAX) return false;
            index=c.protection_count++;
         }
         c.protections[index].position_id=p.position_id;c.protections[index].content_sha=sha;added++;
      }
      return true;
   }

   bool Excluded(const Tov2CaptureRegistration &r,const Tov2CaptureHistoryRow &row)
   {
      if(row.broker_time_msc<r.boundary.started_at_broker_msc) return true;
      if(row.broker_time_msc>=r.boundary.started_at_broker_msc+1000) return false;
      for(int i=0;i<r.boundary.excluded_size;i++)
         if(row.ticket==r.boundary.excluded_boundary_deal_ids[i]) return true;
      return false;
   }

   void ReconcileFromStart(Tov2CaptureCheckpoint &c)
   {
      c.reconcile=true;c.scan_finished=false;c.watermark=0;
      c.forward_start=c.start_msc;c.forward_end=c.start_msc;
      c.rotation_start=c.start_msc;c.rotation_end=c.start_msc;c.rotate_next=false;
   }

   bool SortHistory(Tov2CaptureHistoryPage &page,const int scale)
   {
      if(page.size<0 || page.size>TOV2_CAPTURE_HISTORY_MAX || page.total!=page.size) return false;
      for(int i=0;i<page.size;i++)
      {
         Tov2CaptureHistoryRow row=page.rows[i];
         if(!Tov2Ticket(row.ticket) || !Tov2Counter(row.broker_time_msc,1)) return false;
         if(row.result==TOV2_CAPTURE_OK &&
            (row.ticket!=row.deal.deal_id || row.broker_time_msc!=row.deal.broker_time_msc)) return false;
         int j=i-1;
         while(j>=0 && (page.rows[j].broker_time_msc>row.broker_time_msc ||
            (page.rows[j].broker_time_msc==row.broker_time_msc && StringCompare(page.rows[j].ticket,row.ticket)>0)))
         {page.rows[j+1]=page.rows[j];j--;}
         page.rows[j+1]=row;
      }
      for(int i=0;i<page.size;i++) for(int j=0;j<i;j++)
      {
         if(page.rows[i].ticket!=page.rows[j].ticket) continue;
         string a="",b="";
         if(page.rows[i].result!=TOV2_CAPTURE_OK || page.rows[j].result!=TOV2_CAPTURE_OK ||
            !Tov2CaptureDealContentHash(page.rows[i].deal,scale,a) ||
            !Tov2CaptureDealContentHash(page.rows[j].deal,scale,b) || a!=b) return false;
      }
      return true;
   }

   bool BoundaryIds(string &ids[],const long total)
   {
      int count=ArraySize(ids);
      if(count<0 || count>TOV2_CAPTURE_BOUNDARY_MAX || total!=count) return false;
      for(int i=0;i<count;i++)
      {
         if(!Tov2Ticket(ids[i])) return false;
         string item=ids[i];int j=i-1;
         while(j>=0 && StringCompare(ids[j],item)>0) {ids[j+1]=ids[j];j--;}
         ids[j+1]=item;
      }
      for(int i=1;i<count;i++) if(ids[i]==ids[i-1]) return false;
      return true;
   }

public:
   CTov2JournalCollector()
   {m_ready=false;m_stopped=false;m_restart=false;m_dirty_gap=false;m_dirty=0;m_error="";}
   string LastError() const {return m_error;}
   void MarkDirty(const bool disconnected=false)
   {
      // Callback-side bounded marker only; no broker reads or persistence.
      if(m_dirty<255) m_dirty++;
      else m_dirty_gap=true;
      if(disconnected) m_dirty_gap=true;
   }

   int PrepareEnrollment(ITov2CaptureBroker *broker,const string account_id,
                         const string installation_id,const string tracking_id,const long epoch,
                         const string profile_sha,const string fingerprint,Tov2CaptureEnrollment &out)
   {
      out.identity="";ArrayResize(out.registration,0);ArrayResize(out.capture,0);
      if(CheckPointer(broker)==POINTER_INVALID || !Tov2Identifier(account_id) ||
         !Tov2Identifier(installation_id) || !Tov2Identifier(tracking_id) || !Tov2Counter(epoch) ||
         !Tov2Digest(profile_sha) || !Tov2Digest(fingerprint)) return TOV2_STATE_INVALID;
      for(int attempt=0;attempt<3;attempt++)
      {
         Tov2CaptureRegistration r;ZeroMemory(r);string actual="",after="";
         Tov2CaptureDisplay final_display;
         if(broker.Identity(actual,r.display)!=TOV2_CAPTURE_OK || !Tov2CaptureDisplayValid(r.display))
            return TOV2_STATE_INVALID;
         if(actual!=fingerprint) return Stop(TOV2_STATE_IDENTITY_MISMATCH,"IDENTITY_MISMATCH");
         long utc=0,time=0,utc_after=0,time_after=0,total_a=0,total_b=0;
         if(broker.Clocks(utc,time)!=TOV2_CAPTURE_OK || !Tov2Counter(utc,1) || !Tov2Counter(time,1))
            return TOV2_STATE_INVALID;
         long second=(time/1000)*1000;
         string ids_a[],ids_b[];
         Tov2CaptureResult first=broker.BoundaryTickets(second,ids_a,total_a);
         CTov2AccountSnapshot snapshot(fingerprint);Tov2CaptureAccount account;
         Tov2CaptureResult sampled=snapshot.Capture(broker,account,r.baseline);
         Tov2CaptureResult last=broker.BoundaryTickets(second,ids_b,total_b);
         Tov2CaptureResult identity=broker.Identity(after,final_display);
         Tov2CaptureResult clock=broker.Clocks(utc_after,time_after);
         if(identity!=TOV2_CAPTURE_OK || after!=fingerprint || actual!=after ||
            final_display.currency!=r.display.currency || final_display.currency_scale!=r.display.currency_scale ||
            sampled==TOV2_CAPTURE_IDENTITY_CHANGED)
            return Stop(TOV2_STATE_IDENTITY_MISMATCH,"IDENTITY_MISMATCH");
         if(first!=TOV2_CAPTURE_OK || last!=TOV2_CAPTURE_OK || sampled!=TOV2_CAPTURE_OK ||
            clock!=TOV2_CAPTURE_OK || !BoundaryIds(ids_a,total_a) || !BoundaryIds(ids_b,total_b) ||
            total_a!=total_b || time_after/1000!=time/1000 || utc_after!=utc ||
            r.baseline.observed_at_utc_seconds!=utc || r.baseline.observed_at_broker_msc/1000!=time/1000) continue;
         bool same=true;for(int i=0;i<ArraySize(ids_a);i++) if(ids_a[i]!=ids_b[i]) same=false;
         if(!same || !broker.EnrollmentClockReady(time_after)) continue;
         r.boundary.tracking_id=tracking_id;r.boundary.account_fingerprint_sha256=fingerprint;
         r.boundary.started_at_broker_msc=second;r.boundary.initialized_at_utc_seconds=utc;
         r.boundary.excluded_size=ArraySize(ids_a);
         for(int i=0;i<ArraySize(ids_a);i++) r.boundary.excluded_boundary_deal_ids[i]=ids_a[i];
         string registration="",boundary="",boundary_sha="";
         if(!Tov2CaptureEncodeRegistration(r,registration) || !Tov2CaptureEncodeBoundary(r.boundary,boundary) ||
            !Tov2CaptureRecordHash(boundary,boundary_sha)) return TOV2_STATE_INVALID;
         Tov2CaptureCheckpoint c;Tov2CaptureCheckpointClear(c);
         c.identity=account_id+"~"+installation_id+"~"+tracking_id+"~"+Tov2LocalNumber(epoch)+"~"+
            profile_sha+"~"+fingerprint+"~"+boundary_sha;
         if(!Tov2CaptureRecordHash(registration,c.registration_sha)) return TOV2_STATE_INVALID;
         c.start_msc=second;c.initialized_utc=utc;c.currency_scale=r.display.currency_scale;
         c.forward_start=second;c.forward_end=second;c.rotation_start=second;c.rotation_end=second;
         c.previous_utc=utc;c.previous_broker=time;c.broker_anchor_utc=utc;c.attempt_status="COMPLETE";
         c.attempt_utc=utc;c.attempt_broker=r.baseline.observed_at_broker_msc;
         c.position_count=r.baseline.position_count;c.order_count=r.baseline.order_count;
         if(!Tov2CaptureEncodeAccount(account,c.currency_scale,c.account_json) ||
            !Tov2CaptureEncodeExposure(r.baseline,c.currency_scale,c.last_complete_json)) return TOV2_STATE_INVALID;
         for(int i=0;i<r.baseline.positions_size;i++)
         {
            c.protections[i].position_id=r.baseline.positions[i].position_id;
            if(!Tov2CaptureProtectionContent(r.baseline.positions[i],c.protections[i].content_sha)) return TOV2_STATE_INVALID;
         }
         c.protection_count=r.baseline.positions_size;SortCheckpoint(c);
         uchar reg_bytes[],capture_bytes[];
         if(!Tov2CaptureUtf8Bytes(registration,reg_bytes) || !Tov2CaptureCheckpointEncode(c,capture_bytes) ||
            ArraySize(capture_bytes)>TOV2_CAPTURE_JSON_MAX-TOV2_CAPTURE_DIAGNOSTIC_RESERVE) return TOV2_STATE_LIMIT;
         if(!Tov2LocalCopy(reg_bytes,out.registration) || !Tov2LocalCopy(capture_bytes,out.capture))
         {ArrayResize(out.registration,0);ArrayResize(out.capture,0);return TOV2_STATE_IO_ERROR;}
         out.identity=c.identity;return TOV2_STATE_OK;
      }
      return TOV2_STATE_CONFLICT;
   }

   int InitializeFrozen(CTov2TelemetryState *state,const Tov2CaptureEnrollment &frozen)
   {
      if(CheckPointer(state)==POINTER_INVALID) return TOV2_STATE_INVALID;
      Tov2CaptureCheckpoint c;Tov2CaptureRegistration registration;Tov2LocalState expected;
      Tov2LocalClearState(expected);expected.identity=frozen.identity;expected.capture_schema=TOV2_CAPTURE_SCHEMA;
      if(!Tov2CaptureCheckpointDecode(frozen.capture,c) || c.produced!=0 || c.revision_count!=0 ||
         c.queue_count!=0 || c.scan_finished || c.watermark!=0 || c.record_gap!="-" ||
         c.observation_gap || c.reconcile || c.quarantine ||
         !Tov2CaptureContextMatches(expected,frozen.registration,c,registration)) return TOV2_STATE_INVALID;
      string baseline="";
      if(!Tov2CaptureEncodeExposure(registration.baseline,c.currency_scale,baseline) ||
         baseline!=c.last_complete_json || c.attempt_status!="COMPLETE" ||
         c.forward_start!=c.start_msc || c.forward_end!=c.start_msc ||
         c.rotation_start!=c.start_msc || c.rotation_end!=c.start_msc || c.rotate_next ||
         c.protection_count!=registration.baseline.positions_size) return TOV2_STATE_INVALID;
      for(int i=0;i<registration.baseline.positions_size;i++)
      {
         int index=Tov2CaptureFindProtection(c,registration.baseline.positions[i].position_id);
         string sha="";
         if(index<0 || !Tov2CaptureProtectionContent(registration.baseline.positions[i],sha) ||
            sha!=c.protections[index].content_sha) return TOV2_STATE_INVALID;
      }
      int result=state.InitializeNew(frozen.registration,frozen.capture,TOV2_CAPTURE_SCHEMA);
      if(result==TOV2_STATE_OK) {m_ready=true;m_stopped=false;m_restart=false;m_error="";}
      return result;
   }

   int Recover(CTov2TelemetryState *state)
   {
      m_ready=false;m_stopped=false;m_error="";
      Tov2LocalState local;string root="";Tov2CaptureCheckpoint c;Tov2CaptureRegistration registration;
      int result=Context(state,local,root,c,registration);
      if(result!=TOV2_STATE_OK) return result;
      m_ready=true;m_restart=true;return TOV2_STATE_OK;
   }

   int ReadCoverage(CTov2TelemetryState *state,string &coverage)
   {
      coverage="";Tov2LocalState local;string root="";
      Tov2CaptureCheckpoint c;Tov2CaptureRegistration registration;
      int result=Context(state,local,root,c,registration);
      if(result!=TOV2_STATE_OK) return result;
      Tov2CaptureExposure sample;
      if(!Tov2CaptureDecodeExposure(c.last_complete_json,c.currency_scale,sample))
         return TOV2_STATE_RECOVERY_REQUIRED;
      int deferred=ProtectionChanges(c,sample);
      if(deferred<0) return TOV2_STATE_RECOVERY_REQUIRED;
      coverage=(c.record_gap!="-" || m_stopped)?"DATA_MISSING":
         (!c.scan_finished || c.reconcile || m_restart || deferred>0 ||
          local.accepted_event!=c.produced?"CATCHING_UP":"UP_TO_DATE");
      return TOV2_STATE_OK;
   }

   int Poll(CTov2TelemetryState *state,ITov2CaptureBroker *broker)
   {
      if(!m_ready || m_stopped || CheckPointer(broker)==POINTER_INVALID) return TOV2_STATE_INVALID;
      Tov2LocalState local;string root="";Tov2CaptureCheckpoint prior;Tov2CaptureRegistration registration;
      int result=Context(state,local,root,prior,registration);
      if(result!=TOV2_STATE_OK) return Stop(result,"RECOVERY_REQUIRED");
      if(!SameIdentity(broker,registration))
         return m_stopped?TOV2_STATE_IDENTITY_MISMATCH:PersistGap(state,root,prior,"CAPTURE_FAILED",true);
      long utc=0,time=0;
      Tov2CaptureResult clock=broker.Clocks(utc,time);
      if(!SameIdentity(broker,registration))
         return m_stopped?TOV2_STATE_IDENTITY_MISMATCH:PersistGap(state,root,prior,"CAPTURE_FAILED",true);
      if(clock!=TOV2_CAPTURE_OK || !Tov2Counter(utc,1) || !Tov2Counter(time,1))
         return PersistGap(state,root,prior,"CAPTURE_FAILED",true);
      Tov2CaptureCheckpoint next=prior;
      PurgeAcknowledged(next,local.accepted_event);
      next.observation_gap=next.observation_gap || m_restart || m_dirty_gap;
      long utc_delta=utc-prior.previous_utc,broker_delta=time-prior.previous_broker;
      long anchored_utc_delta=utc-prior.broker_anchor_utc;
      // Last-quote broker time may remain unchanged on an idle market.
      // Compare a moving quote with UTC at the previous broker advance, not an intervening idle poll.
      // Five seconds of receipt lag is tolerated; no timezone offset is applied.
      bool clock_changed=utc_delta<0 || broker_delta<0 ||
         (broker_delta>0 && MathAbs((double)(broker_delta-anchored_utc_delta*1000))>5000);
      next.previous_utc=utc;next.previous_broker=time;
      if(broker_delta>0) next.broker_anchor_utc=utc;
      // Repeated positive times before enrollment cannot produce eligible snapshots or events.
      if(clock_changed || utc<prior.initialized_utc || time<prior.start_msc)
      {
         next.broker_anchor_utc=utc;
         if(!next.quarantine) next.record_gap="CLOCK_DISCONTINUITY";
         next.observation_gap=true;ReconcileFromStart(next);
         Tov2AppendCandidate none[];uchar arena[];int ends[];
         result=Publish(state,root,next,none,arena,ends);
         if(result!=TOV2_STATE_OK) return Stop(result,"PERSISTENCE_ERROR");
         m_restart=false;m_dirty_gap=false;m_dirty=0;return TOV2_STATE_OK;
      }
      Tov2CaptureExposure sample;
      if(!Tov2CaptureDecodeExposure(prior.last_complete_json,prior.currency_scale,sample))
         return Stop(TOV2_STATE_RECOVERY_REQUIRED,"OUTBOX_CORRUPT");
      int deferred=ProtectionChanges(prior,sample);
      bool capture_failed=prior.attempt_status!="COMPLETE";
      if(deferred<0) return Stop(TOV2_STATE_INVALID,"CAPTURE_FAILED");
      if(deferred>0)
      {
         // This exact persisted sample remains authoritative until every change is appended.
         if(m_dirty>0) next.observation_gap=true;
      }
      else
      {
         CTov2AccountSnapshot snapshot(registration.boundary.account_fingerprint_sha256);
         Tov2CaptureAccount account;Tov2CaptureExposure attempt;
         Tov2CaptureResult captured=snapshot.Capture(broker,account,attempt);
         if(!SameIdentity(broker,registration) || captured==TOV2_CAPTURE_IDENTITY_CHANGED)
            return Stop(TOV2_STATE_IDENTITY_MISMATCH,"IDENTITY_MISMATCH");
         if(account.observed_at_utc_seconds<prior.initialized_utc || attempt.observed_at_utc_seconds<prior.initialized_utc ||
            !Tov2CaptureEncodeAccount(account,prior.currency_scale,next.account_json))
            return PersistGap(state,root,prior,"CAPTURE_FAILED",true);
         next.attempt_status=attempt.status;next.attempt_utc=attempt.observed_at_utc_seconds;
         next.attempt_broker=attempt.observed_at_broker_msc;next.position_count=attempt.position_count;next.order_count=attempt.order_count;
         if(attempt.status=="COMPLETE")
         {
            sample=attempt;
            if(!Tov2CaptureEncodeExposure(sample,prior.currency_scale,next.last_complete_json))
               return PersistGap(state,root,prior,"CAPTURE_FAILED",true);
         }
         else next.observation_gap=true;
         capture_failed=captured!=TOV2_CAPTURE_OK;
         if(capture_failed && !next.quarantine) next.record_gap="CAPTURE_FAILED";
      }
      if(next.record_gap!="-" && !next.reconcile && !next.quarantine) ReconcileFromStart(next);
      bool rotating=next.rotate_next && next.watermark>=next.start_msc && !next.reconcile;
      long from=rotating?next.rotation_start:next.forward_start;
      long through=rotating?next.rotation_end:next.forward_end;
      Tov2CaptureAccount current_account;
      if(!Tov2CaptureDecodeAccount(next.account_json,next.currency_scale,current_account))
         return Stop(TOV2_STATE_INVALID,"CAPTURE_FAILED");
      capture_failed=capture_failed || current_account.status!="COMPLETE";
      long snapshot_upper=MathMax(current_account.observed_at_broker_msc,next.attempt_broker);
      long target=rotating?MathMin(next.watermark,time):MathMin(time,snapshot_upper);
      if(through<=from) through=MathMin(from+59999,target);
      else through=MathMin(through,target);
      if(from>through) return PersistGap(state,root,prior,"CLOCK_DISCONTINUITY",true);
      Tov2CaptureHistoryPage page;Tov2CaptureResult history=TOV2_CAPTURE_READ_FAILED;
      // At most six splits turn a sixty-second window into one broker second.
      for(int split=0;split<7;split++)
      {
         if(!SameIdentity(broker,registration)) return Stop(TOV2_STATE_IDENTITY_MISMATCH,"IDENTITY_MISMATCH");
         history=broker.History(from,through,page);
         if(!SameIdentity(broker,registration)) return Stop(TOV2_STATE_IDENTITY_MISMATCH,"IDENTITY_MISMATCH");
         if(history!=TOV2_CAPTURE_LIMIT_EXCEEDED) break;
         long seconds=through/1000-from/1000+1;
         if(seconds<=1) break;
         through=(from/1000+seconds/2)*1000-1;
      }
      if(history==TOV2_CAPTURE_LIMIT_EXCEEDED || history==TOV2_CAPTURE_READ_FAILED)
         return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true);
      if(history!=TOV2_CAPTURE_OK && history!=TOV2_CAPTURE_UNSUPPORTED)
         return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true);
      if(!SortHistory(page,prior.currency_scale))
         return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true);
      for(int i=0;i<page.size;i++)
      {
         if(page.rows[i].broker_time_msc<from || page.rows[i].broker_time_msc>through || Excluded(registration,page.rows[i])) continue;
         if(page.rows[i].result!=TOV2_CAPTURE_OK)
         {
            if(page.rows[i].raw_type<0 || page.rows[i].raw_reason<0)
               return PersistGap(state,root,prior,"UNSUPPORTED_RECORD",true);
            Tov2CaptureCheckpoint diagnostic=prior;
            diagnostic.quarantine=true;diagnostic.quarantine_ticket=page.rows[i].ticket;
            diagnostic.quarantine_msc=page.rows[i].broker_time_msc;
            diagnostic.quarantine_type=page.rows[i].raw_type;diagnostic.quarantine_reason=page.rows[i].raw_reason;
            diagnostic.record_gap="UNSUPPORTED_RECORD";diagnostic.scan_finished=false;
            // The new complete sample is discarded with this prior-authority diagnostic.
            diagnostic.observation_gap=true;
            Tov2AppendCandidate none[];uchar arena[];int ends[];
            result=Publish(state,root,diagnostic,none,arena,ends,true);
            if(result!=TOV2_STATE_OK) return Stop(result,"PERSISTENCE_ERROR");
            m_error="UNSUPPORTED_RECORD";return TOV2_STATE_OK;
         }
      }
      // A fully read window must still contain every previously indexed ticket in its range.
      for(int i=0;i<prior.revision_count;i++)
      {
         if(prior.revisions[i].broker_msc<from || prior.revisions[i].broker_msc>through) continue;
         bool present=false;
         for(int j=0;j<page.size;j++) if(page.rows[j].ticket==prior.revisions[i].ticket) present=true;
         if(!present) return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true);
      }
      int wanted_history=0;
      for(int i=0;i<page.size;i++)
      {
         if(page.rows[i].broker_time_msc<from || page.rows[i].broker_time_msc>through || Excluded(registration,page.rows[i])) continue;
         bool duplicate=false;for(int j=0;j<i;j++) if(page.rows[j].ticket==page.rows[i].ticket) duplicate=true;
         if(duplicate) continue;
         string content="";int index=Tov2CaptureFindRevision(prior,page.rows[i].ticket);
         if(!Tov2CaptureDealContentHash(page.rows[i].deal,prior.currency_scale,content))
            return PersistGap(state,root,prior,"UNSUPPORTED_RECORD",true);
         if(index<0 || prior.revisions[index].content_sha!=content) wanted_history++;
      }
      int wanted_protection=ProtectionChanges(next,sample);
      if(wanted_protection<0) return PersistGap(state,root,prior,"CAPTURE_FAILED",true);
      int protection_budget=MathMin(wanted_protection,MathMax(16,32-wanted_history));
      int history_budget=32-protection_budget;
      Tov2AppendCandidate events[];uchar arena[];int ends[];
      int added_history=0;bool finished=true;
      for(int i=0;i<page.size;i++)
      {
         Tov2CaptureHistoryRow row=page.rows[i];
         if(row.broker_time_msc<from || row.broker_time_msc>through || Excluded(registration,row)) continue;
         string content="",json="";int index=Tov2CaptureFindRevision(next,row.ticket);
         if(!Tov2CaptureDealContentHash(row.deal,next.currency_scale,content)) return PersistGap(state,root,prior,"UNSUPPORTED_RECORD",true);
         if(index>=0 && next.revisions[index].content_sha==content) continue;
         if(added_history>=history_budget) {finished=false;continue;}
         if(index<0 && next.revision_count>=TOV2_CAPTURE_REVISIONS_MAX)
            return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true,true);
         long revision=index<0?1:next.revisions[index].revision+1;
         string previous=index<0?"":next.revisions[index].record_sha;
         if(!Tov2CaptureEncodeDeal(row.deal,next.currency_scale,revision,previous,json) ||
            !StageRecord(next,json,row.ticket,revision,utc,events,arena,ends))
            return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true,true);
         if(index<0) index=next.revision_count++;
         next.revisions[index].ticket=row.ticket;next.revisions[index].revision=revision;
         next.revisions[index].content_sha=content;next.revisions[index].broker_msc=row.broker_time_msc;
         next.revisions[index].record_sha=events[ArraySize(events)-1].record_sha;added_history++;
      }
      if(!StageProtections(next,sample,32-added_history,events,arena,ends))
         return PersistGap(state,root,prior,"CAPTURE_FAILED",true,true);
      if(rotating)
      {
         next.rotation_start=from;next.rotation_end=through;
         if(finished)
         {
            next.rotation_start=through>=target?next.start_msc:through+1;
            next.rotation_end=next.rotation_start;next.rotate_next=false;
         }
      }
      else
      {
         next.forward_start=from;next.forward_end=through;
         if(finished)
         {
            if(through>=target)
            {
               next.reconcile=false;next.watermark=through;next.scan_finished=true;
               next.forward_start=(through/1000)*1000;next.forward_end=next.forward_start;
               next.rotate_next=true;
               if(!next.quarantine && !capture_failed) next.record_gap="-";
            }
            else
            {
               if(!next.reconcile) next.watermark=through;
               next.forward_start=through+1;next.forward_end=next.forward_start;
               next.scan_finished=false;
               if(next.watermark>0) next.rotate_next=true;
            }
         }
      }
      if(!finished) next.scan_finished=false;
      if(next.quarantine) {next.record_gap="UNSUPPORTED_RECORD";next.scan_finished=false;}
      result=Publish(state,root,next,events,arena,ends);
      if(result==TOV2_STATE_LIMIT) return PersistGap(state,root,prior,"HISTORY_UNAVAILABLE",true,true);
      if(result!=TOV2_STATE_OK) return Stop(result,"PERSISTENCE_ERROR");
      m_restart=false;m_dirty_gap=false;m_dirty=0;m_error=next.record_gap=="-"?"":next.record_gap;
      return TOV2_STATE_OK;
   }
};
#endif
