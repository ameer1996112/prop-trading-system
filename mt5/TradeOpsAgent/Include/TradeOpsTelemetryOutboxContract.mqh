#ifndef TRADEOPS_TELEMETRY_OUTBOX_CONTRACT_MQH
#define TRADEOPS_TELEMETRY_OUTBOX_CONTRACT_MQH
#include "TradeOpsTelemetryStorageCodec.mqh"

const int TOV2_OUTBOX_BUILD_OK=0;
const int TOV2_OUTBOX_BUILD_SIZE_LIMIT=1;
const int TOV2_OUTBOX_BUILD_INVALID=2;
const int TOV2_OUTBOX_RESPONSE_MAX=16384;

struct Tov2OutboxContext
{
   Tov2LocalState state;
   string root_sha;
};

struct Tov2OutboxCandidate
{
   long expected_generation;
   string expected_root_sha;
   string registration_sha;
   long request_sequence;
   string body_sha;
   int prefix_count;
   long frozen_produced;
};

struct Tov2OutboxAcceptance
{
   string identity;
   string registration_sha;
   long request_sequence;
   string body_sha;
   string pending_sha;
   long final_event;
   long accepted_at;
};

void Tov2OutboxClearCandidate(Tov2OutboxCandidate &candidate)
{
   candidate.expected_generation=0; candidate.expected_root_sha="";
   candidate.registration_sha=""; candidate.request_sequence=0;
   candidate.body_sha=""; candidate.prefix_count=0; candidate.frozen_produced=0;
}

void Tov2OutboxClearAcceptance(Tov2OutboxAcceptance &accepted)
{
   accepted.identity=""; accepted.registration_sha=""; accepted.request_sequence=0;
   accepted.body_sha=""; accepted.pending_sha="";
   accepted.final_event=0; accepted.accepted_at=0;
}

// Trusted, injected, non-owning adapter. Production v2: TradeOpsTelemetryOutboxV2.mqh.
// Every validator receives bytes loaded by State, never caller approval flags.
class ITov2TelemetryOutboxAdapter
{
public:
   virtual int Build(const Tov2OutboxContext &context,const uchar &registration[],
                     const uchar &event_arena[],const int &event_ends[],
                     const int prefix_count,Tov2OutboxCandidate &candidate,
                     uchar &request[])=0;
   virtual bool ValidateRequest(const Tov2OutboxContext &context,
                     const uchar &registration[],const uchar &event_arena[],
                     const int &event_ends[],const Tov2OutboxCandidate &candidate,
                     const uchar &request[])=0;
   virtual bool ValidateResponse(const Tov2LocalState &state,
                     const uchar &pending[],const uchar &response[],
                     Tov2OutboxAcceptance &accepted)=0;
   virtual bool ValidateReplacement(const Tov2LocalState &state,
                     const uchar &pending[],const uchar &rejection[],
                     const uchar &replacement[],const string replacement_body_sha)=0;
};

#endif
