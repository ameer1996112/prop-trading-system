#ifndef TRADEOPS_TELEMETRY_OUTBOX_MQH
#define TRADEOPS_TELEMETRY_OUTBOX_MQH
#include "TradeOpsTelemetryState.mqh"

class CTov2TelemetryOutbox
{
private:
   // Non-owning dependencies; constructor performs no virtual calls or I/O.
   CTov2TelemetryState *m_state;
   ITov2TelemetryOutboxAdapter *m_adapter;

   bool StateValid() { return CheckPointer(m_state)!=POINTER_INVALID; }
   bool AdapterValid() { return CheckPointer(m_adapter)!=POINTER_INVALID; }

public:
   CTov2TelemetryOutbox(CTov2TelemetryState *state,ITov2TelemetryOutboxAdapter *adapter)
   {
      m_state=state; m_adapter=adapter;
   }

   int Request(uchar &persisted[])
   {
      ArrayResize(persisted,0);
      if(!StateValid()) return TOV2_STATE_INVALID;
      int pending=m_state.ReadPending(persisted);
      if(pending!=TOV2_STATE_NOT_STARTED) return pending;
      if(!AdapterValid()) return TOV2_STATE_INVALID;
      Tov2OutboxContext context; uchar registration[],arena[]; int ends[];
      int read=m_state.ReadOutboxContext(context,registration,arena,ends);
      if(read!=TOV2_STATE_OK) return read;
      if(context.state.accepted_request>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      int count=0;
      for(int i=0;i<context.state.event_count && i<TOV2_LOCAL_BATCH;i++)
      {
         if(context.state.events[i].sequence!=context.state.accepted_event+1+i)
            return TOV2_STATE_RECOVERY_REQUIRED;
         bool repeated=false;
         for(int j=0;j<i;j++)
            if(context.state.events[i].deal_id!="-" &&
               context.state.events[j].deal_id==context.state.events[i].deal_id) repeated=true;
         if(repeated) break;
         count++;
      }
      while(true)
      {
         Tov2OutboxCandidate candidate; Tov2OutboxClearCandidate(candidate);
         uchar request[];
         int built=m_adapter.Build(context,registration,arena,ends,count,candidate,request);
         if(!StateValid() || !AdapterValid()) return TOV2_STATE_INVALID;
         if(built==TOV2_OUTBOX_BUILD_OK)
         {
            if(ArraySize(request)<1 || ArraySize(request)>TOV2_RECORD_PAYLOAD_MAX ||
               candidate.prefix_count!=count) return TOV2_STATE_INVALID;
            return m_state.PreparePending(m_adapter,candidate,request,persisted);
         }
         if(built!=TOV2_OUTBOX_BUILD_SIZE_LIMIT) return TOV2_STATE_INVALID;
         if(count<=1) return TOV2_STATE_LIMIT;
         count--;
      }
   }

   int Accept(const uchar &response[])
   {
      if(!StateValid()) return TOV2_STATE_INVALID;
      return m_state.AcceptResponse(m_adapter,response);
   }

   int Replace(const uchar &rejection[],const uchar &replacement[],
               const string body_sha,uchar &persisted[])
   {
      ArrayResize(persisted,0);
      if(!StateValid()) return TOV2_STATE_INVALID;
      return m_state.ReplaceRejected(m_adapter,rejection,replacement,body_sha,persisted);
   }
};
#endif
