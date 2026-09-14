#property strict
#include "../Include/TradeOpsTelemetryWireV2.mqh"
#include "../Include/TradeOpsTelemetryResponseV2.mqh"
#include "../Include/TradeOpsTelemetryRecord.mqh"

const int TOV2_WIRE_VECTOR_COUNT=12;
int tov2_wire_checks=0;
int tov2_wire_failures=0;
string tov2_wire_scenario="";

class CTov2WireTestFixture
{
public:
   CTov2WireRequest request;
};

void Tov2WireTestCheck(const bool pass,const string label)
{
   tov2_wire_checks++;
   if(pass) return;
   tov2_wire_failures++;
   PrintFormat("TOV2_WIRE_CHECK_FAIL scenario=%s label=%s index=%d",
      tov2_wire_scenario,label,tov2_wire_checks);
}

bool Tov2WireTestUtf8(const string text,uchar &bytes[])
{
   ArrayResize(bytes,0);
   const int size=StringToCharArray(text,bytes,0,WHOLE_ARRAY,CP_UTF8);
   if(size<2 || ArraySize(bytes)!=size || bytes[size-1]!=0)
   {
      ArrayResize(bytes,0);
      return false;
   }
   if(ArrayResize(bytes,size-1)!=size-1)
   {
      ArrayResize(bytes,0);
      return false;
   }
   return true;
}

bool Tov2WireTestCopy(const uchar &source[],uchar &target[])
{
   ArrayResize(target,0);
   const int count=ArraySize(source);
   if(ArrayResize(target,count)!=count) return false;
   for(int i=0;i<count;i++) target[i]=source[i];
   return true;
}

bool Tov2WireTestEqual(const uchar &left[],const uchar &right[])
{
   const int count=ArraySize(left);
   if(count!=ArraySize(right)) return false;
   for(int i=0;i<count;i++) if(left[i]!=right[i]) return false;
   return true;
}

bool Tov2WireLoadVector(const int index,string &name,string &request_utf8,
                        string &response_utf8,string &request_sha256,
                        string &response_sha256,long &expected_ack)
{
   name="";
   request_utf8="";
   response_utf8="";
   request_sha256="";
   response_sha256="";
   expected_ack=-1;
   if(index==0)
   {
      name="idle-complete-scale-2";
      expected_ack=0;
      request_sha256="8997a9d275b304cd210a3c66dc426b35defd742f2cc03e06e213a421e80be823";
      response_sha256="63aa76c0772c282f60f195b89c6bd0dd5edf4cf287e34b9338574407d5a64ceb";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"a31ced7d7f7550bf3304c054b471121294c35";
      request_utf8+="d61239d9f74bd5bb994c7892f7e\",\"collection\":{\"observation_gap\":false,\"produced_events\":0,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":0,\"last_error\":null,\"last_successful_upload_utc_seconds\":null,\"local_unsent_events\":0,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"reported_s";
      request_utf8+="ource_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_pro";
      request_utf8+="file_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status";
      request_utf8+="\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":1,\"schema_versi";
      request_utf8+="on\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":0,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"a31ced7d7f7550bf3304c054b471121294c35d61239d9f74bd5bb994c7892f7e\",\"request_sequence\":1,\"response_body_sha256\":\"abca134af19058b3d37ca9e964507341e0282331c6bbee3dfb397111a16de6ac\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==1)
   {
      name="one-deal-scale-2";
      expected_ack=1;
      request_sha256="914e0f1ae63cdbeb6fee3be4fc01ba7017e5b15739339df6da96a4c65ef59a88";
      response_sha256="15ec7577ad13e69dcaae80627711416d23b138bd5b994376b1af12092e0caec8";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"a0fbc80b1ce767c254b19a7dbc6df40edd1af";
      request_utf8+="462279f119bed782b1fe407e9bd\",\"collection\":{\"observation_gap\":false,\"produced_events\":1,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":1,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":1,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"repo";
      request_utf8+="rted_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"event-1\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"1\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"pre";
      request_utf8+="vious_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"";
      request_utf8+="c9661c0379aa6bbdfae0c540b61ab000ebbcb485f7f24ca8df136311471050cb\",\"sequence\":1}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      request_utf8+="aaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbb";
      request_utf8+="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":2,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":1,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"a0fbc80b1ce767c254b19a7dbc6df40edd1af462279f119bed782b1fe407e9bd\",\"request_sequence\":2,\"response_body_sha256\":\"57d04b67f5d67ff7af8a88da4804920a6098ed8f644054def9cae9eaa9cbad9c\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==2)
   {
      name="protection-scale-2";
      expected_ack=1;
      request_sha256="2deaad8ee35728a9313a63ac3fd58a43c1d4dffd8bd6c5dcf7220582eaea647d";
      response_sha256="a7bfeaff678a9773eddba63b87c42c1abb064b1c3570f2bd897a9798f805b0f6";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"afb672228a1f0de618e257c993a548a725fce";
      request_utf8+="0205eca31315cb2ddea4820c352\",\"collection\":{\"observation_gap\":false,\"produced_events\":1,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":2,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":1,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"repo";
      request_utf8+="rted_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"protection-1\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"kind\":\"PROTECTION_OBSERVATION\",\"observed_at_broker_msc\":1800000000123,\"position_id\":\"9007199254740993\",\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"source\":\"TRANSACTION_OBSERVATION\",\"symbol\":\"EURUSD.a\",\"ticket\":\"700\",\"tp\":{\"reason\":null,\"value\":{";
      request_utf8+="\"scale\":5,\"value\":\"1.12000\"}}},\"record_sha256\":\"828e5e9578f0a19c6795389bd4232fdf8bec9fa800292002c2e0e810bd2d9efc\",\"sequence\":1}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaa";
      request_utf8+="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"";
      request_utf8+="account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":3,\"schema_version\":\"AgentSyncRequestV2\",\"s";
      request_utf8+="ent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":1,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"afb672228a1f0de618e257c993a548a725fce0205eca31315cb2ddea4820c352\",\"request_sequence\":3,\"response_body_sha256\":\"2030595e67741d5138f33d32b0950320ad3a343491ad98b1ccff66e2434bcb78\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==3)
   {
      name="32-contiguous-events-scale-2";
      expected_ack=32;
      request_sha256="511d3bfbee85c99e36e41a538ec575fec1558325665881dcb4563ccb5a049f85";
      response_sha256="641702c7f7e4bcb142580a2d34d621f71d0be26f94fd83d41de8d0175dd78df9";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"3bc7c72008ab027e9e812a64931b0a2fbe57b";
      request_utf8+="f8d69b9124aa5072fcfd5fd00d8\",\"collection\":{\"observation_gap\":false,\"produced_events\":32,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":3,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":32,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"re";
      request_utf8+="ported_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"event-1\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"1\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"p";
      request_utf8+="revious_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\"";
      request_utf8+=":\"c9661c0379aa6bbdfae0c540b61ab000ebbcb485f7f24ca8df136311471050cb\",\"sequence\":1},{\"event_id\":\"event-2\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"2\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1";
      request_utf8+=".10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"d0b3b6ca9c6fa92fd6152d1992267c2b2d248bf7b772297b2be3ebef794f2598\",\"sequence\":2";
      request_utf8+="},{\"event_id\":\"event-3\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"3\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protecti";
      request_utf8+="on_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"0527463810d552aa80110e2a6bfe50f3363ebb4f62202def7a8178740e0fd4da\",\"sequence\":3},{\"event_id\":\"event-4\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_t";
      request_utf8+="ime_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"4\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{";
      request_utf8+="\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"f7c9058079d2a7cf1c4fe5ba4abb375c190f06374381e276f2a66330878681d8\",\"sequence\":4},{\"event_id\":\"event-5\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-";
      request_utf8+="0.20\"}},\"deal_id\":\"5\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"v";
      request_utf8+="alue\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"794b01020656ba865a80381d44e5303a3e29c94b0e6735160ddeb3542eb79a36\",\"sequence\":5},{\"event_id\":\"event-6\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"6\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"val";
      request_utf8+="ue\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"valu";
      request_utf8+="e\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"b3744f0d95fee06aec03b1f731145f3b87bf9b6c60455772355f3aa799a9fb53\",\"sequence\":6},{\"event_id\":\"event-7\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"7\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"p";
      request_utf8+="revious_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\"";
      request_utf8+=":\"c2c6a4d079c6dd41733cf3efad0d8fb7aaa737eaafb5ebd9d1d300a0ff42dd73\",\"sequence\":7},{\"event_id\":\"event-8\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"8\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1";
      request_utf8+=".10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"b49d072ea3727eb1900a5be195b4539a1e145ecf856732f290028c0e889da9f1\",\"sequence\":8";
      request_utf8+="},{\"event_id\":\"event-9\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"9\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protecti";
      request_utf8+="on_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"8aaf3ef456fae22caf1853e1ae2ee3746c851abce84d1833624d60149c0cc042\",\"sequence\":9},{\"event_id\":\"event-10\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_";
      request_utf8+="time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"10\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\"";
      request_utf8+=":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"e9a9518c9aa1d0e759f0e013229ebfd371c7162e2f58a295a47f88c935ea0c12\",\"sequence\":10},{\"event_id\":\"event-11\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value";
      request_utf8+="\":\"-0.20\"}},\"deal_id\":\"11\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\"";
      request_utf8+=":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"6372cf44307decfb3d9ef8dffac50b69170559e174325f799172332f74bf5f2b\",\"sequence\":11},{\"event_id\":\"event-12\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"12\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale";
      request_utf8+="\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\"";
      request_utf8+=":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"46951f469b032b635b3c59948e540e573056c7f3d9bad3cc7fc9e517c111204b\",\"sequence\":12},{\"event_id\":\"event-13\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"13\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"900719925";
      request_utf8+="4740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"rec";
      request_utf8+="ord_sha256\":\"9f35e4c0cb5598a21a7604c6b4a0f2434b495cfd09ba83fcb0a1583f129e03c1\",\"sequence\":13},{\"event_id\":\"event-14\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"14\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale";
      request_utf8+="\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"6ed30dde9319551df3180012f47430246fd2b821457feb8411060c8a6224e845";
      request_utf8+="\",\"sequence\":14},{\"event_id\":\"event-15\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"15\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"1";
      request_utf8+="0.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"d0fba679d68dc6e05516c4e277fb7554c6dcbb1b4788bb7216bfff5f6e398672\",\"sequence\":15},{\"event_id\":\"event-16\",\"observed_at_utc_seconds\":1800000010,";
      request_utf8+="\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"16\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null";
      request_utf8+=",\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"73ad9ac9c7fb76378bf6844d28237361933285885c4580c9c73aa2806c661faf\",\"sequence\":16},{\"event_id\":\"event-17\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\"";
      request_utf8+=":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"17\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":nul";
      request_utf8+="l,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"0fca0f9ab7bf72650ad6a089392b47b647fe7e93f3e1aa8f44c122074363b1d3\",\"sequence\":17},{\"event_id\":\"event-18\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"18\",\"entry\":\"OUT\",\"fee\":{\"reason\":nu";
      request_utf8+="ll,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":nul";
      request_utf8+="l,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"d3f40bac1266836af39bc210275b85439ceb121f8f46951baa8664835472286e\",\"sequence\":18},{\"event_id\":\"event-19\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"19\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"posit";
      request_utf8+="ion_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"va";
      request_utf8+="lue\":\"0.10\"}},\"record_sha256\":\"d42b07bd1b87426d02bf09db2074f1d61c1af8c072bf6ffae6d9d3031d53ee0d\",\"sequence\":19},{\"event_id\":\"event-20\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"20\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":nu";
      request_utf8+="ll,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"2354bf6178fa3be308bf3f9a6b5e2455056bccd10f1bb2";
      request_utf8+="5ec4996437077ebf34\",\"sequence\":20},{\"event_id\":\"event-21\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"21\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"s";
      request_utf8+="cale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"74adc83bb9db7a9c70ee0b87e4357e9531810f4b1657dc54e9184f4550bb9e56\",\"sequence\":21},{\"event_id\":\"event-22\",\"observed_at_utc_se";
      request_utf8+="conds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"22\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"re";
      request_utf8+="versal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"d329d61801bb73815e8965f6aa2f64d85fa1a09ad29d82332b85c849c6b91689\",\"sequence\":22},{\"event_id\":\"event-23\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"re";
      request_utf8+="ason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"23\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"s";
      request_utf8+="wap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"2e736cc337e0665decb44c2ea4c88b3b4750c5ab0902322b029fe3f09a24ec3a\",\"sequence\":23},{\"event_id\":\"event-24\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"24\",\"entry\":\"OUT\",";
      request_utf8+="\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",";
      request_utf8+="\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"8eadb853f7b30fb477a28180e9bcac41133902b696bb2e2e5b763432cf51a298\",\"sequence\":24},{\"event_id\":\"event-25\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"25\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"orde";
      request_utf8+="r_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volu";
      request_utf8+="me\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"68aada78d9e25684f81290a7ebcffc0a6ca44312798045303c0e673b128b0026\",\"sequence\":25},{\"event_id\":\"event-26\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"26\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"p";
      request_utf8+="rice\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"28f1d87c994e3b142d818db79c69";
      request_utf8+="096ca979d7cc0c87e42c7581d8d31a498682\",\"sequence\":26},{\"event_id\":\"event-27\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"27\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason";
      request_utf8+="\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"dd8720af60ba40987578a69d07912a6860a548798a93c52cf1eb2f4d5459e797\",\"sequence\":27},{\"event_id\":\"event-28\",\"";
      request_utf8+="observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"28\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\"";
      request_utf8+=",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"7b58df3d5053881d11e8c6650b602e0a9e7781ea49431df67a4750612d594672\",\"sequence\":28},{\"event_id\":\"event-29\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000";
      request_utf8+=",\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"29\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE";
      request_utf8+="\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"0010c4af882a7d06d4ebb956286e740e4dea3c2cf48db431c949c854d0f253c5\",\"sequence\":29},{\"event_id\":\"event-30\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"";
      request_utf8+="30\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"s";
      request_utf8+="ymbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"4f18befdabce6047d1999e11cac04e1ec9f15e6de3b224c2511601893a5657ad\",\"sequence\":30},{\"event_id\":\"event-31\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"31\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"";
      request_utf8+="kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},";
      request_utf8+="\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"2b62afdc1fb03e2eb88a5e23f598633aa2b8090a3378c82e15ac06bd5fcb70e6\",\"sequence\":31},{\"event_id\":\"event-32\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"32\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_reco";
      request_utf8+="rd_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"5555b22bdc";
      request_utf8+="106626f00b7723a0aca863ec03a96d5558bc4100e36e5da5c16a22\",\"sequence\":32}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"ins";
      request_utf8+="tallation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      request_utf8+="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":4,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":32,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-instal";
      response_utf8+="lation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"3bc7c72008ab027e9e812a64931b0a2fbe57bf8d69b9124aa5072fcfd5fd00d8\",\"request_sequence\":4,\"response_body_sha256\":\"8b0519bed2b35b1187fb500d6294169875fb8aad82933be17061ccdab1120f2f\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==4)
   {
      name="produced-backlog-beyond-uploaded-prefix-scale-2";
      expected_ack=10;
      request_sha256="362d1353c5522edfc97524a0da2f63b22c889ab51e30da5f109a7a814cd02549";
      response_sha256="bf3efe854ff400d3f89cb26efde3d2cd0e8789657b736b496299a3c5e8676148";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"cc5502a9658581aa16ffd84345fb3ef832df6";
      request_utf8+="71dfc36ee6fcb6a40a8ce17116b\",\"collection\":{\"observation_gap\":false,\"produced_events\":40,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":4,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":35,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"re";
      request_utf8+="ported_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"event-6\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"6\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"p";
      request_utf8+="revious_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\"";
      request_utf8+=":\"b3744f0d95fee06aec03b1f731145f3b87bf9b6c60455772355f3aa799a9fb53\",\"sequence\":6},{\"event_id\":\"event-7\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"7\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1";
      request_utf8+=".10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"c2c6a4d079c6dd41733cf3efad0d8fb7aaa737eaafb5ebd9d1d300a0ff42dd73\",\"sequence\":7";
      request_utf8+="},{\"event_id\":\"event-8\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"8\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protecti";
      request_utf8+="on_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"b49d072ea3727eb1900a5be195b4539a1e145ecf856732f290028c0e889da9f1\",\"sequence\":8},{\"event_id\":\"event-9\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_t";
      request_utf8+="ime_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"9\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{";
      request_utf8+="\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"8aaf3ef456fae22caf1853e1ae2ee3746c851abce84d1833624d60149c0cc042\",\"sequence\":9},{\"event_id\":\"event-10\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"";
      request_utf8+="-0.20\"}},\"deal_id\":\"10\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,";
      request_utf8+="\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"e9a9518c9aa1d0e759f0e013229ebfd371c7162e2f58a295a47f88c935ea0c12\",\"sequence\":10}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbb";
      request_utf8+="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":5,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc";
      request_utf8+="_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"ma";
      request_utf8+="rgin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":5,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":10,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":30,\"reason\":null,\"state\":\"CATCHING_UP\",\"through_broker_msc\":null},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\"";
      response_utf8+=",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"cc5502a9658581aa16ffd84345fb3ef832df671dfc36ee6fcb6a40a8ce17116b\",\"request_sequence\":5,\"response_body_sha256\":\"22781c0786fd4fa38b77ed0f010efd0dedab479476338977f46fd18bc009aaaf\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==5)
   {
      name="record-gap-scale-2";
      expected_ack=0;
      request_sha256="64348731af4e4ab83195344dbdd01820a69c8282fca0aa782b1cf1626be0e447";
      response_sha256="bb5eb413eba97d09f8893f4deaa19b1019c0b321eb98feaad014bc5eec185b82";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"0cf100b1bd22189d68e2c7763b56567d23d8e";
      request_utf8+="d9498aabb1f22d450248c39c0eb\",\"collection\":{\"observation_gap\":false,\"produced_events\":0,\"record_gap\":\"HISTORY_UNAVAILABLE\",\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":5,\"last_error\":\"HISTORY_UNAVAILABLE\",\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":0,\"observed_at_utc_seconds\":1800000010,\"re";
      request_utf8+="ported_manifest_sha256\":null,\"reported_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"acco";
      request_utf8+="unt_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"";
      request_utf8+="position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-De";
      request_utf8+="mo\"}},\"request_sequence\":6,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":0,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":\"HISTORY_UNAVAILABLE\",\"state\":\"DATA_MISSING\",\"through_broker_msc\":null},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthet";
      response_utf8+="ic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"0cf100b1bd22189d68e2c7763b56567d23d8ed9498aabb1f22d450248c39c0eb\",\"request_sequence\":6,\"response_body_sha256\":\"aa3459336274ff5748f2d58ebd96c269588e17ec6572fd0cfeec8689a53f5e9c\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==6)
   {
      name="observation-gap-scale-2";
      expected_ack=0;
      request_sha256="520b267863486a3c37968098271558e14fb7fcb9558905abda693bb37184a671";
      response_sha256="eeb7f2a5cbe7d8e4399749006895c322a911785400da2aa488b67e4ff0b45210";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"893badf1df629c1de72197026dbd15f5a684b";
      request_utf8+="95dcdfff5c145e778b5f49a9b41\",\"collection\":{\"observation_gap\":true,\"produced_events\":0,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":6,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":0,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"repor";
      request_utf8+="ted_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"accoun";
      request_utf8+="t_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"s";
      request_utf8+="tatus\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":7,\"schema_";
      request_utf8+="version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":0,\"command\":null,\"coverage\":{\"observation_gap\":true,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installa";
      response_utf8+="tion\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"893badf1df629c1de72197026dbd15f5a684b95dcdfff5c145e778b5f49a9b41\",\"request_sequence\":7,\"response_body_sha256\":\"b450e7ce1f63346ebcf9478e72bfaf60f1c80149b1d726fb69f9c7773ff3f301\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==7)
   {
      name="unfinished-scan-scale-2";
      expected_ack=0;
      request_sha256="4654bac80d14bf9c512fb8184959169902b19f8b7844d84bec9b19570f890785";
      response_sha256="0bb3fcf256b185327fada5e97f470a20e15e9790ea7c74112d78a6923fbf362f";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"52fbb297b55c3433b14da97ae168ddcd4c406";
      request_utf8+="fa40cc5ef18e3d3bb094a6770b4\",\"collection\":{\"observation_gap\":false,\"produced_events\":0,\"record_gap\":null,\"scan_finished\":false,\"scan_through_broker_msc\":null},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":7,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":0,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"reported_sou";
      request_utf8+="rce_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profi";
      request_utf8+="le_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":";
      request_utf8+="\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":8,\"schema_version";
      request_utf8+="\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":0,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"CATCHING_UP\",\"through_broker_msc\":null},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"";
      response_utf8+="safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"52fbb297b55c3433b14da97ae168ddcd4c406fa40cc5ef18e3d3bb094a6770b4\",\"request_sequence\":8,\"response_body_sha256\":\"f5ed73be9567758f46798efd9a9e818a250cea1f947e6ca8896e642b1a10b1ef\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==8)
   {
      name="unicode-symbol-company-scale-2";
      expected_ack=1;
      request_sha256="573eabcc69087a1e760a8066bd1fd08926245746915d1baf73c77113319452cc";
      response_sha256="62a83e8a9d7ca368f75fa452610159b3dbd85c60086af76bb7265b71187ee4a7";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"56ba499dc0dba468685c350a9bb9138dc5717";
      request_utf8+="721ce1f83bc753caceb3e2429f8\",\"collection\":{\"observation_gap\":false,\"produced_events\":1,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":8,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":1,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"repo";
      request_utf8+="rted_source_sha256\":null,\"source_symbol\":\"זהב.测试\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"protection-1\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"kind\":\"PROTECTION_OBSERVATION\",\"observed_at_broker_msc\":1800000000123,\"position_id\":\"9007199254740993\",\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"source\":\"TRANSACTION_OBSERVATION\",\"symbol\":\"זהב.测试\",\"ticket\":\"700\",\"tp\":{\"reason\":null,\"value\":{\"s";
      request_utf8+="cale\":5,\"value\":\"1.12000\"}}},\"record_sha256\":\"332bc900145876d97ec4c7e064b0c4ecce8b08a2f27c3031c629bd70108f99d4\",\"sequence\":1}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":1,\"positions\":[{\"current_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10010\"}},\"entry_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"floating_profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"1.00\"";
      request_utf8+="}},\"position_id\":\"9007199254740993\",\"side\":\"BUY\",\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.01\"}},\"symbol\":\"זהב.测试\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"volume\":{\"scale\":2,\"value\":\"0.10\"}}],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaa";
      request_utf8+="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\"";
      request_utf8+=":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"ברוקר בדיקה 東京\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"שרת-デモ\"}},\"request_sequence\":9,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_";
      request_utf8+="utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":1,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"56ba499dc0dba468685c350a9bb9138dc5717721ce1f83bc753caceb3e2429f8\",\"request_sequence\":9,\"response_body_sha256\":\"b402099e9eb517ffea9332ec9a3b1770657ef1f2c165ce1c6821e6e389e3b5ac\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==9)
   {
      name="large-tickets-scale-2";
      expected_ack=1;
      request_sha256="bb617f9cb48ed766510352c4353b34c7d780ac3dd4df1c7a4ea31a6e775579b0";
      response_sha256="ede31c796834cf71b29802a95979d28011918c941fc939ee0559d81ed8838269";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"c59b04c8cdfc4c184bcfebd3fe56682815604";
      request_utf8+="c5c21a94f37fa918fe1fa397fa4\",\"collection\":{\"observation_gap\":false,\"produced_events\":1,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":9,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":1,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"repo";
      request_utf8+="rted_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"event-1\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"18446744073709551615\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"18446744073709551614\",\"";
      request_utf8+="position_id\":\"18446744073709551613\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"sca";
      request_utf8+="le\":2,\"value\":\"0.10\"}},\"record_sha256\":\"5c886b89e0b6cd57be10215ca9ec9aa7234445e9dd0f3b7e05013bd16a41ea0f\",\"sequence\":1}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":1,\"positions\":[{\"current_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10010\"}},\"entry_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"floating_profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"1.00\"}},\"po";
      request_utf8+="sition_id\":\"18446744073709551613\",\"side\":\"BUY\",\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.01\"}},\"symbol\":\"EURUSD.a\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"volume\":{\"scale\":2,\"value\":\"0.10\"}}],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaa";
      request_utf8+="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\"";
      request_utf8+=":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":10,\"schema_version\":\"AgentSyncRequestV2";
      request_utf8+="\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":1,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"c59b04c8cdfc4c184bcfebd3fe56682815604c5c21a94f37fa918fe1fa397fa4\",\"request_sequence\":10,\"response_body_sha256\":\"b5625c1fca9bd44dfcbfca8921415f2e710e1d2e177ab668cdf06fc52ad8b9eb\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==10)
   {
      name="currency-scale-0-incomplete-account";
      expected_ack=0;
      request_sha256="723bf6b46506c3d01d220512c05bb20198a3284e39584d7000c0613f52ff5c37";
      response_sha256="d5c1fdaffb22a14c940f715bc3d1117ef32c3ad3929a8a16be2c51ebe3560929";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"equity\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"margin_free\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"margin_level\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"margin_used\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"CAPTURE_FAILED\"},\"body_sha256\":\"02706be5cc483951030e5d8446f21c5ae8d9f7462d6ba51b023f9128194faee2\",\"collection\":{\"observation_gap\":";
      request_utf8+="false,\"produced_events\":0,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":10,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":0,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"reported_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_";
      request_utf8+="build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":1,\"positions\":[{\"current_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10010\"}},\"entry_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"floating_profit\":{\"reason\":null,\"value\":{\"scale\":0,\"value\":\"1\"}},\"position_id\":\"9007199254";
      request_utf8+="740993\",\"side\":\"BUY\",\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":0,\"value\":\"-1\"}},\"symbol\":\"EURUSD.a\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"volume\":{\"scale\":2,\"value\":\"0.10\"}}],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      request_utf8+="aaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256";
      request_utf8+="\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"JPY\",\"currency_scale\":0,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":11,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":18000";
      request_utf8+="00010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":0,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"02706be5cc483951030e5d8446f21c5ae8d9f7462d6ba51b023f9128194faee2\",\"request_sequence\":11,\"response_body_sha256\":\"f2f9573bfedc4cf39d3709a03572efadea173f8c795101fd91c70c9385475571\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   else if(index==11)
   {
      name="currency-scale-8-incomplete-exposure";
      expected_ack=0;
      request_sha256="66be87c8fc23d73848a2dd26721c4f4d10122ba7c6b33141d3e0cd4afe049845";
      response_sha256="e6350e962bc31803959e5c852deedd2c65672834035e9df127ed8cc7a6217532";
      request_utf8+="{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"10000.00000000\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"10000.00000000\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"10000.00000000\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"0.00000000\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"2f28ccfb3b84a";
      request_utf8+="2729db25d6ea7d80dbb8c13dd50e53c00f1c76b2cc82d829f6a\",\"collection\":{\"observation_gap\":false,\"produced_events\":0,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":11,\"last_error\":null,\"last_successful_upload_utc_seconds\":1800000010,\"local_unsent_events\":0,\"observed_at_utc_seconds\":1800000010,\"reported_ma";
      request_utf8+="nifest_sha256\":null,\"reported_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":null,\"orders\":[],\"position_count\":null,\"positions\":[],\"status\":\"LIMIT_EXCEEDED\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"a";
      request_utf8+="ccount_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[";
      request_utf8+="],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"BTC\",\"currency_scale\":8,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic";
      request_utf8+="-Demo\"}},\"request_sequence\":12,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}";
      response_utf8+="{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":0,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-install";
      response_utf8+="ation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"2f28ccfb3b84a2729db25d6ea7d80dbb8c13dd50e53c00f1c76b2cc82d829f6a\",\"request_sequence\":12,\"response_body_sha256\":\"15682eab73ba15e31cd43a0113096e3175e6c9dd681f3924392b01843fbabbb3\",\"schema_version\":\"AgentSyncResponseV2\"}";
      return true;
   }
   return false;
}

void Tov2WireRunVector(const int index)
{
   string name="",request_text="",response_text="",request_sha256="",response_sha256="";
   long expected_ack=-1;
   const bool loaded=Tov2WireLoadVector(index,name,request_text,response_text,
      request_sha256,response_sha256,expected_ack);
   tov2_wire_scenario=loaded?name:IntegerToString(index);
   PrintFormat("TOV2_WIRE_SCENARIO index=%d name=%s",index,tov2_wire_scenario);
   Tov2WireTestCheck(loaded,"vector.load");
   if(!loaded) return;

   uchar pending[],response[];
   Tov2WireTestCheck(Tov2WireTestUtf8(request_text,pending),"request.utf8");
   Tov2WireTestCheck(Tov2WireTestUtf8(response_text,response),"response.utf8");
   if(ArraySize(pending)==0 || ArraySize(response)==0) return;
   string actual_hash="";
   Tov2WireTestCheck(Tov2RecordHash(pending,actual_hash) && actual_hash==request_sha256,
      "request.whole_byte_sha256");
   Tov2WireTestCheck(Tov2RecordHash(response,actual_hash) && actual_hash==response_sha256,
      "response.whole_byte_sha256");

   CTov2WireTestFixture *decoded=new CTov2WireTestFixture;
   Tov2WireTestCheck(CheckPointer(decoded)!=POINTER_INVALID,"request.allocate");
   if(CheckPointer(decoded)==POINTER_INVALID) return;

   Tov2WireExpected expected;
   const bool decoded_ok=Tov2WireDecodeRequest(pending,decoded.request,expected);
   Tov2WireTestCheck(decoded_ok,"request.decode");
   if(decoded_ok)
   {
      uchar encoded[];
      Tov2WireExpected encoded_expected;
      Tov2WireTestCheck(Tov2WireEncodeRequest(decoded.request,encoded,encoded_expected),"request.encode");
      Tov2WireTestCheck(Tov2WireTestEqual(pending,encoded),"request.byte_equal");
      Tov2WireTestCheck(encoded_expected.request_body_sha256==expected.request_body_sha256,
         "request.expected_digest");
      uchar repeated[];
      Tov2WireTestCheck(Tov2WireEncodeRequest(decoded.request,repeated,encoded_expected) &&
         Tov2WireTestEqual(encoded,repeated),"request.repeat_determinism");

      Tov2WireAck ack;
      const bool verified=Tov2WireVerifyResponse(pending,response,ack);
      Tov2WireTestCheck(verified,"response.verify");
      Tov2WireTestCheck(verified && ack.acknowledged_event_sequence==expected_ack,
         "response.expected_acknowledgement");
      Tov2WireTestCheck(verified && ack.request_sequence==decoded.request.request_sequence,
         "response.request_sequence");
      Tov2WireTestCheck(verified && ack.request_body_sha256==expected.request_body_sha256,
         "response.request_digest");
   }

   uchar invalid_request[];
   Tov2WireTestCheck(Tov2WireTestCopy(pending,invalid_request),"mutation.request_copy");
   if(ArraySize(invalid_request)>0)
   {
      invalid_request[0]=(uchar)(invalid_request[0]^1);
      CTov2WireTestFixture *rejected=new CTov2WireTestFixture;
      Tov2WireTestCheck(CheckPointer(rejected)!=POINTER_INVALID,"mutation.request_allocate");
      if(CheckPointer(rejected)!=POINTER_INVALID)
      {
         rejected.request.identity.account_id="prefilled";
         Tov2WireExpected rejected_expected;
         rejected_expected.identity.account_id="prefilled";
         Tov2WireTestCheck(!Tov2WireDecodeRequest(invalid_request,rejected.request,rejected_expected),
            "mutation.request_rejected");
         Tov2WireTestCheck(rejected.request.identity.account_id=="" &&
            rejected_expected.identity.account_id=="" &&
            rejected_expected.request_body_sha256=="","mutation.request_cleared");
         delete rejected;
      }
   }

   uchar invalid_response[];
   Tov2WireTestCheck(Tov2WireTestCopy(response,invalid_response),"mutation.response_copy");
   if(ArraySize(invalid_response)>0)
   {
      invalid_response[0]=(uchar)(invalid_response[0]^1);
      Tov2WireAck rejected_ack;
      rejected_ack.request_body_sha256="prefilled";
      rejected_ack.response_body_sha256="prefilled";
      Tov2WireTestCheck(!Tov2WireVerifyResponse(pending,invalid_response,rejected_ack),
         "mutation.response_rejected");
      Tov2WireTestCheck(rejected_ack.request_body_sha256=="" &&
         rejected_ack.response_body_sha256=="","mutation.response_cleared");
   }

   delete decoded;
   PrintFormat("TOV2_WIRE_SCENARIO_COMPLETE index=%d name=%s",index,name);
}

bool Tov2WireTestLoadRequest(const int index,CTov2WireRequest &request)
{
   string name="",pending="",response="",ph="",rh="";long ack=0;
   uchar bytes[];Tov2WireExpected expected;
   return Tov2WireLoadVector(index,name,pending,response,ph,rh,ack) &&
      Tov2WireTestUtf8(pending,bytes) && Tov2WireDecodeRequest(bytes,request,expected);
}

void Tov2WireTestRejectEncode(CTov2WireRequest &request,const string label)
{
   uchar bytes[];ArrayResize(bytes,1);bytes[0]=123;
   Tov2WireExpected expected;expected.identity.account_id="prefilled";expected.request_body_sha256="prefilled";
   Tov2WireTestCheck(!Tov2WireEncodeRequest(request,bytes,expected),label);
   Tov2WireTestCheck(ArraySize(bytes)==0 && expected.identity.account_id=="" && expected.request_body_sha256=="",label+".clear");
}

void Tov2WireTestRejectText(const string text,CTov2WireRequest &request,const string label)
{
   uchar bytes[];Tov2WireExpected expected;
   if(!Tov2WireTestUtf8(text,bytes)) {Tov2WireTestCheck(false,label+".bytes");return;}
   request.identity.account_id="old";expected.request_body_sha256="old";
   Tov2WireTestCheck(!Tov2WireDecodeRequest(bytes,request,expected),label);
   Tov2WireTestCheck(request.identity.account_id=="" && expected.request_body_sha256=="",label+".clear");
}

bool Tov2WireTestRepairBody(string &text)
{
   string key=",\"body_sha256\":\"";
   int at=StringFind(text,key);
   if(at<0) return false;
   int tail=at+StringLen(key)+65;
   string hash="",body=StringSubstr(text,0,at)+StringSubstr(text,tail);
   if(!Tov2CaptureRecordHash(body,hash)) return false;
   text=StringSubstr(text,0,at)+key+hash+"\""+StringSubstr(text,tail);
   return true;
}

bool Tov2WireTestRepairResponse(string &text)
{
   string key=",\"response_body_sha256\":\"";
   int at=StringFind(text,key);
   if(at<0) return false;
   int tail=at+StringLen(key)+65;
   string hash="",body=StringSubstr(text,0,at)+StringSubstr(text,tail);
   if(!Tov2CaptureRecordHash(body,hash)) return false;
   text=StringSubstr(text,0,at)+key+hash+"\""+StringSubstr(text,tail);
   return true;
}

void Tov2WireTestRejectResponse(const string pending_text,const string response_text,const string label)
{
   uchar pending[],response[];
   if(!Tov2WireTestUtf8(pending_text,pending) || !Tov2WireTestUtf8(response_text,response))
   {Tov2WireTestCheck(false,label+".bytes");return;}
   Tov2WireAck ack;
   ack.request_sequence=7;ack.acknowledged_event_sequence=8;ack.accepted_at_utc_seconds=9;
   ack.request_body_sha256="prefilled";ack.response_body_sha256="prefilled";
   Tov2WireTestCheck(!Tov2WireVerifyResponse(pending,response,ack),label);
   Tov2WireTestCheck(ack.request_sequence==0 && ack.acknowledged_event_sequence==0 &&
      ack.accepted_at_utc_seconds==0 && ack.request_body_sha256=="" &&
      ack.response_body_sha256=="",label+".clear");
}

void Tov2WireTestRehashedResponseMutation(const string pending,const string response,
   const string from,const string to,const string label)
{
   string altered=response;
   if(StringReplace(altered,from,to)!=1 || !Tov2WireTestRepairResponse(altered))
   {Tov2WireTestCheck(false,label+".prepare");return;}
   Tov2WireTestRejectResponse(pending,altered,label);
}

void Tov2WireRunResponseMutations()
{
   tov2_wire_scenario="response-mutations";
   string name="",pending="",response="",request_hash="",response_hash="";long expected_ack=0;
   if(!Tov2WireLoadVector(1,name,pending,response,request_hash,response_hash,expected_ack))
   {Tov2WireTestCheck(false,"load");return;}

   Tov2WireTestRehashedResponseMutation(pending,response,"\"account_id\":\"synthetic-account\"","\"account_id\":\"other-account\"","identity.account_id");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"installation_id\":\"synthetic-installation\"","\"installation_id\":\"other-installation\"","identity.installation_id");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"tracking_id\":\"synthetic-tracking\"","\"tracking_id\":\"other-tracking\"","identity.tracking_id");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"safety_epoch\":7","\"safety_epoch\":8","identity.safety_epoch");
   Tov2WireTestRehashedResponseMutation(pending,response,
      "\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"",
      "\"account_profile_sha256\":\"caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"","identity.account_profile");
   Tov2WireTestRehashedResponseMutation(pending,response,
      "\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"",
      "\"account_fingerprint_sha256\":\"cbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"","identity.account_fingerprint");
   Tov2WireTestRehashedResponseMutation(pending,response,
      "\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\"",
      "\"tracking_boundary_sha256\":\"a44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\"","identity.tracking_boundary");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"request_sequence\":2","\"request_sequence\":3","request.sequence");
   Tov2WireTestRehashedResponseMutation(pending,response,
      "\"request_body_sha256\":\"a0fbc80b1ce767c254b19a7dbc6df40edd1af462279f119bed782b1fe407e9bd\"",
      "\"request_body_sha256\":\"b0fbc80b1ce767c254b19a7dbc6df40edd1af462279f119bed782b1fe407e9bd\"","request.digest");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"acknowledged_event_sequence\":1","\"acknowledged_event_sequence\":0","ack.below");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"acknowledged_event_sequence\":1","\"acknowledged_event_sequence\":2","ack.above");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"accepted_at_utc_seconds\":1800000010","\"accepted_at_utc_seconds\":0","accepted.nonpositive");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"state\":\"UP_TO_DATE\"","\"state\":\"CATCHING_UP\"","coverage.state");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"through_broker_msc\":1800000010000","\"through_broker_msc\":null","coverage.through");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"pending_events\":0","\"pending_events\":1","coverage.pending");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"reason\":null","\"reason\":\"HISTORY_UNAVAILABLE\"","coverage.reason");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"observation_gap\":false","\"observation_gap\":true","coverage.observation");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"mode\":\"DRY_RUN\"","\"mode\":\"LIVE\"","mode");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"command\":null","\"command\":{\"kind\":\"BUY\"}","command");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"schema_version\":\"AgentSyncResponseV2\"","\"schema_version\":\"AgentSyncResponseV1\"","schema");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"schema_version\":","\"rogue\":null,\"schema_version\":","extra.key");
   Tov2WireTestRehashedResponseMutation(pending,response,"\"request_sequence\":2","\"request_sequence\":2,\"request_sequence\":2","duplicate.key");

   string truncated=response;StringSetLength(truncated,StringLen(truncated)-1);
   Tov2WireTestRejectResponse(pending,truncated,"truncated");
   string oversized=response;
   while(StringLen(oversized)<=TOV2_WIRE_RESPONSE_MAX) oversized+="x";
   Tov2WireTestRejectResponse(pending,oversized,"bytes.16385");

   string old=response;
   if(StringReplace(old,"\"accepted_at_utc_seconds\":1800000010","\"accepted_at_utc_seconds\":1")==1 &&
      Tov2WireTestRepairResponse(old))
   {
      uchar pending_bytes[],response_bytes[];Tov2WireAck ack;
      bool ok=Tov2WireTestUtf8(pending,pending_bytes) && Tov2WireTestUtf8(old,response_bytes) &&
         Tov2WireVerifyResponse(pending_bytes,response_bytes,ack);
      Tov2WireTestCheck(ok && ack.accepted_at_utc_seconds==1,"accepted.old.retry");
   }
   else Tov2WireTestCheck(false,"accepted.old.retry.prepare");

   uchar pending_bytes[],response_bytes[];
   if(Tov2WireTestUtf8(pending,pending_bytes) && Tov2WireTestUtf8(response,response_bytes))
   {
      pending_bytes[0]=(uchar)(pending_bytes[0]^1);Tov2WireAck ack;ack.request_body_sha256="prefilled";
      Tov2WireTestCheck(!Tov2WireVerifyResponse(pending_bytes,response_bytes,ack),"pending.invalid");
      Tov2WireTestCheck(ack.request_sequence==0 && ack.request_body_sha256=="" && ack.response_body_sha256=="","pending.invalid.clear");
   }
   else Tov2WireTestCheck(false,"pending.invalid.prepare");
}

void Tov2WireTestPadSymbol(string &symbol,int &remaining)
{
   int extra=remaining<189?remaining:189;
   symbol="S";
   for(int j=0;j<extra/3;j++) symbol+="界";
   if(extra%3==2) symbol+="é";
   if(extra%3==1) symbol+="a";
   remaining-=extra;
}

void Tov2WireRunRequestBounds()
{
   tov2_wire_scenario="request-bounds";
   CTov2WireRequest *r=new CTov2WireRequest;
   CTov2WireRequest *decoded=new CTov2WireRequest;
   const bool allocated=CheckPointer(r)!=POINTER_INVALID && CheckPointer(decoded)!=POINTER_INVALID;
   Tov2WireTestCheck(allocated,"allocate");
   if(!allocated)
   {
      if(CheckPointer(r)!=POINTER_INVALID) delete r;
      if(CheckPointer(decoded)!=POINTER_INVALID) delete decoded;
      return;
   }
   if(!Tov2WireTestLoadRequest(8,r)) {Tov2WireTestCheck(false,"load");delete r;delete decoded;return;}
   // The matching receiver test derives the same valid rows. No whitespace suffix.
   Tov2CapturePosition position=r.exposure.positions[0];
   if(!Tov2WireTestLoadRequest(0,r)) {Tov2WireTestCheck(false,"idle.load");delete r;delete decoded;return;}
   Tov2CaptureOrder order;ZeroMemory(order);
   order.symbol="S";order.type="BUY_LIMIT";order.state="PLACED";
   order.volume_initial.value="0.10";order.volume_initial.scale=2;
   order.volume_current=order.volume_initial;
   Tov2CaptureMissing(order.price,"UNAVAILABLE");Tov2CaptureMissing(order.stop_limit_price,"UNAVAILABLE");
   Tov2CaptureMissing(order.sl,"UNAVAILABLE");Tov2CaptureMissing(order.tp,"UNAVAILABLE");
   for(int i=0;i<128;i++)
   {
      position.ticket=IntegerToString(1000+i);position.position_id=IntegerToString(2000+i);position.symbol="S";
      order.ticket=IntegerToString(3000+i);
      r.exposure.positions[i]=position;r.registration.baseline.positions[i]=position;
      r.exposure.orders[i]=order;r.registration.baseline.orders[i]=order;
   }
   r.exposure.positions_size=128;r.exposure.orders_size=128;r.exposure.position_count=128;r.exposure.order_count=128;
   r.registration.baseline.positions_size=128;r.registration.baseline.orders_size=128;
   r.registration.baseline.position_count=128;r.registration.baseline.order_count=128;
   uchar first[],second[];Tov2WireExpected expected;
   bool base=Tov2WireEncodeRequest(r,first,expected);Tov2WireTestCheck(base,"full.arrays.encode");
   if(base)
   {
      string full=CharArrayToString(first,0,ArraySize(first),CP_UTF8),too_many="",row="";
      order.ticket="9999";Tov2CaptureEncodeOrder(order,row);too_many=full;
      StringReplace(too_many,"\"orders\":[","\"orders\":["+row+",");
      StringReplace(too_many,"\"order_count\":128","\"order_count\":129");
      Tov2WireTestCheck(Tov2WireTestRepairBody(too_many),"orders.129.rehash");
      Tov2WireTestRejectText(too_many,decoded,"orders.129.decode");
      position.ticket="9999";position.position_id="9998";Tov2CaptureEncodePosition(position,2,row);too_many=full;
      StringReplace(too_many,"\"positions\":[","\"positions\":["+row+",");
      StringReplace(too_many,"\"position_count\":128","\"position_count\":129");
      Tov2WireTestCheck(Tov2WireTestRepairBody(too_many),"positions.129.rehash");
      Tov2WireTestRejectText(too_many,decoded,"positions.129.decode");
      int remaining=262144-ArraySize(first);
      Tov2WireTestCheck(remaining>0 && remaining<=512*189,"padding.capacity");
      for(int i=0;i<128;i++) Tov2WireTestPadSymbol(r.exposure.positions[i].symbol,remaining);
      for(int i=0;i<128;i++) Tov2WireTestPadSymbol(r.exposure.orders[i].symbol,remaining);
      for(int i=0;i<128;i++) Tov2WireTestPadSymbol(r.registration.baseline.positions[i].symbol,remaining);
      for(int i=0;i<128;i++) Tov2WireTestPadSymbol(r.registration.baseline.orders[i].symbol,remaining);
      bool exact=remaining==0 && Tov2WireEncodeRequest(r,first,expected) && ArraySize(first)==262144;
      Tov2WireTestCheck(exact,"bytes.262144");
      if(exact)
      {
         Tov2WireTestCheck(Tov2WireDecodeRequest(first,decoded,expected),"large.first.decode");
         r.request_sequence=2;r.diagnostics.last_accepted_request_sequence=1;
         bool other=Tov2WireEncodeRequest(r,second,expected) && ArraySize(second)==262144 && !Tov2WireTestEqual(first,second);
         Tov2WireTestCheck(other,"large.second.distinct");
         if(other) Tov2WireTestCheck(Tov2WireDecodeRequest(second,decoded,expected) && decoded.request_sequence==2 &&
            expected.request_sequence==2 && decoded.exposure.positions_size==128,"large.second.decode");
         r.diagnostics.source_symbol+="x";
         Tov2WireTestRejectEncode(r,"bytes.262145.encode");
         string oversized=CharArrayToString(second,0,ArraySize(second),CP_UTF8);
         StringReplace(oversized,"\"source_symbol\":\"EURUSD\"","\"source_symbol\":\"EURUSDx\"");
         Tov2WireTestCheck(Tov2WireTestRepairBody(oversized),"bytes.262145.rehash");
         uchar over[];Tov2WireTestUtf8(oversized,over);
         Tov2WireTestCheck(ArraySize(over)==262145,"bytes.262145.exact");
         Tov2WireTestRejectText(oversized,decoded,"bytes.262145.decode");
      }
   }
   Tov2WireTestLoadRequest(0,r);
   if(Tov2WireEncodeRequest(r,first,expected))
   {
      string raw=CharArrayToString(first,0,ArraySize(first),CP_UTF8),altered="";
      Tov2WireTestRejectText(ShortToString(0xFEFF)+raw,decoded,"BOM");
      Tov2WireTestRejectText(raw+"\n",decoded,"trailing.bytes");
      altered=raw;StringReplace(altered,"\"request_sequence\":1","\"request_sequence\":1.0");Tov2WireTestRejectText(altered,decoded,"decimal.counter");
      altered=raw;StringReplace(altered,"\"request_sequence\":1","\"request_sequence\":01");Tov2WireTestRejectText(altered,decoded,"leading.zero.counter");
      altered=raw;StringReplace(altered,"\"request_sequence\":1","\"request_sequence\":9007199254740992");Tov2WireTestRejectText(altered,decoded,"unsafe.counter");
      altered=raw;StringReplace(altered,"\"request_sequence\":1","\"request_sequence\":1,\"request_sequence\":1");Tov2WireTestRejectText(altered,decoded,"duplicate.key");
      altered=raw;StringReplace(altered,"\"request_sequence\":1,","");Tov2WireTestRejectText(altered,decoded,"missing.key");
      altered=raw;StringReplace(altered,"\"request_sequence\":1","\"request_sequence\":1,\"rogue\":null");Tov2WireTestRejectText(altered,decoded,"extra.key");
      altered=raw;StringReplace(altered,"EURUSD","\\u0045URUSD");Tov2WireTestRejectText(altered,decoded,"alternate.escape");
      altered=raw;StringReplace(altered,"EURUSD","\\ud800");Tov2WireTestRejectText(altered,decoded,"lone.surrogate");
      altered=raw;StringReplace(altered,"\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null}","\"margin_level\":{\"reason\":null,\"value\":null}");Tov2WireTestRejectText(altered,decoded,"wrong.null");
      altered=raw;StringReplace(altered,expected.request_body_sha256,r.identity.account_profile_sha256);Tov2WireTestRejectText(altered,decoded,"body.hash");
      first[1]=255;Tov2WireTestCheck(!Tov2WireDecodeRequest(first,decoded,expected),"invalid.utf8");
   }
   delete r;delete decoded;
}

void Tov2WireRunRequestMutations()
{
   tov2_wire_scenario="request-mutations";
   CTov2WireRequest *r=new CTov2WireRequest;
   Tov2WireTestCheck(CheckPointer(r)!=POINTER_INVALID,"allocate");
   if(CheckPointer(r)==POINTER_INVALID) return;
   if(!Tov2WireTestLoadRequest(1,r)) {Tov2WireTestCheck(false,"load");delete r;return;}
   uchar good[],bad[];Tov2WireExpected expected;
   Tov2WireTestCheck(Tov2WireEncodeRequest(r,good,expected),"valid.encode");
   Tov2WireTestCopy(good,bad);ArrayResize(bad,ArraySize(bad)-1);
   Tov2WireTestCheck(!Tov2WireDecodeRequest(bad,r,expected),"truncated.after.success");
   Tov2WireTestCheck(r.identity.account_id=="" && r.event_count==0 && r.events[0].record_json=="" &&
      expected.identity.account_id=="" && expected.request_body_sha256=="","truncated.clear");
   Tov2WireTestLoadRequest(1,r);r.event_count=33;Tov2WireTestRejectEncode(r,"events.33");
   Tov2WireTestLoadRequest(1,r);r.exposure.positions_size=129;Tov2WireTestRejectEncode(r,"positions.129");
   Tov2WireTestLoadRequest(1,r);r.exposure.orders_size=129;Tov2WireTestRejectEncode(r,"orders.129");
   Tov2WireTestLoadRequest(1,r);r.registration.baseline.positions_size=129;Tov2WireTestRejectEncode(r,"baseline.positions.129");
   Tov2WireTestLoadRequest(1,r);r.registration.boundary.excluded_size=1025;Tov2WireTestRejectEncode(r,"boundary.1025");
   Tov2WireTestLoadRequest(1,r);r.collection.produced_events=0;Tov2WireTestRejectEncode(r,"produced");
   Tov2WireTestLoadRequest(1,r);r.diagnostics.local_unsent_events++;Tov2WireTestRejectEncode(r,"backlog");
   Tov2WireTestLoadRequest(1,r);r.diagnostics.last_accepted_request_sequence++;Tov2WireTestRejectEncode(r,"accepted.sequence");
   Tov2WireTestLoadRequest(1,r);r.collection.scan_through_broker_msc=0;Tov2WireTestRejectEncode(r,"finished.watermark");
   Tov2WireTestLoadRequest(1,r);r.diagnostics.terminal_connection_state="READY";Tov2WireTestRejectEncode(r,"unknown.enum");
   Tov2WireTestLoadRequest(1,r);r.identity.tracking_boundary_sha256=r.identity.account_profile_sha256;Tov2WireTestRejectEncode(r,"boundary.hash");
   Tov2WireTestLoadRequest(1,r);r.events[0].record_sha256=r.identity.account_profile_sha256;Tov2WireTestRejectEncode(r,"record.hash");
   Tov2WireTestLoadRequest(1,r);r.events[0].observed_at_utc_seconds=r.registration.boundary.initialized_at_utc_seconds-1;Tov2WireTestRejectEncode(r,"event.utc.prestart");
   Tov2WireTestLoadRequest(1,r);StringReplace(r.events[0].record_json,"1800000005000","1799999999999");
   Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);Tov2WireTestRejectEncode(r,"deal.prestart");
   Tov2WireTestLoadRequest(1,r);StringReplace(r.events[0].record_json,"\"revision\":1","\"revision\":2");
   Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);Tov2WireTestRejectEncode(r,"revision.previous");
   Tov2WireTestLoadRequest(1,r);
   r.registration.boundary.excluded_size=1;r.registration.boundary.excluded_boundary_deal_ids[0]="42";
   string boundary="";Tov2CaptureEncodeBoundary(r.registration.boundary,boundary);
   Tov2CaptureRecordHash(boundary,r.identity.tracking_boundary_sha256);
   StringReplace(r.events[0].record_json,"\"deal_id\":\"700\"","\"deal_id\":\"42\"");
   // Set the ID through the parsed wire record, independent of the fixture's original ticket.
   CTov2WireReader rr;Tov2WireRecord record;string canonical="";
   bool parsed=rr.Start(r.events[0].record_json) && rr.Record(record,canonical) && rr.Done();
   Tov2WireTestCheck(parsed,"boundary.record.parse");
   if(parsed)
   {
      record.deal.deal_id="42";record.deal.broker_time_msc=r.registration.boundary.started_at_broker_msc+999;
      r.events[0].record_json=Tov2WireDealJson(record);Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);
      Tov2WireTestRejectEncode(r,"boundary.excluded.second");
      record.deal.broker_time_msc++;r.events[0].record_json=Tov2WireDealJson(record);Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);
      Tov2WireTestCheck(Tov2WireEncodeRequest(r,good,expected),"boundary.after.second");
   }
   Tov2WireTestLoadRequest(0,r);r.account.margin_level.reason="";r.account.margin_level.fixed.value="0.00";r.account.margin_level.fixed.scale=2;
   Tov2WireTestCheck(Tov2WireEncodeRequest(r,good,expected),"zero.margin.known.level");
   r.account.status="CAPTURE_FAILED";Tov2WireTestRejectEncode(r,"failed.account.known");
   Tov2WireTestLoadRequest(1,r);
   StringReplace(r.events[0].record_json,"\"entry\":\"OUT\"","\"entry\":\"INOUT\"");
   StringReplace(r.events[0].record_json,"\"reversal_split\":null","\"reversal_split\":{\"closing_volume\":{\"scale\":2,\"value\":\"0.03\"},\"opening_volume\":{\"scale\":2,\"value\":\"0.07\"},\"source\":\"RECONSTRUCTED_POSITION_VOLUME\"}");
   Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);
   Tov2WireTestCheck(Tov2WireEncodeRequest(r,good,expected),"reversal.valid");
   Tov2WireTestCheck(Tov2WireDecodeRequest(good,r,expected) && StringFind(r.events[0].record_json,"0.03")>=0,"reversal.lossless");
   StringReplace(r.events[0].record_json,"0.07","0.08");Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);
   Tov2WireTestRejectEncode(r,"reversal.sum");
   for(int i=0;i<2;i++)
   {
      Tov2WireTestLoadRequest(1,r);
      StringReplace(r.events[0].record_json,"\"entry\":\"OUT\"","\"entry\":\"NONE\"");
      StringReplace(r.events[0].record_json,"\"type\":\"BUY\"","\"type\":\"BALANCE\"");
      StringReplace(r.events[0].record_json,"\"volume\":{\"scale\":2,\"value\":\"0.10\"}","\"volume\":{\"scale\":2,\"value\":"+(i==0?"\"0.00\"":"\"-0.10\"")+"}");
      Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);
      Tov2WireTestCheck(Tov2WireEncodeRequest(r,good,expected),"nontrading.volume");
      StringReplace(r.events[0].record_json,"\"entry\":\"NONE\"","\"entry\":\"OUT\"");StringReplace(r.events[0].record_json,"\"type\":\"BALANCE\"","\"type\":\"BUY\"");
      Tov2CaptureRecordHash(r.events[0].record_json,r.events[0].record_sha256);Tov2WireTestRejectEncode(r,"trading.nonpositive");
   }
   Tov2WireTestLoadRequest(3,r);r.events[0].sequence=3;
   Tov2WireTestCheck(Tov2WireEncodeRequest(r,good,expected),"state.prefix.not.invented");
   Tov2WireAck ack;ack.request_body_sha256="old";ack.response_body_sha256="old";ack.request_sequence=7;
   Tov2WireClearAck(ack);Tov2WireTestCheck(ack.request_body_sha256=="" && ack.response_body_sha256=="" && ack.request_sequence==0,"ack.clear");
   delete r;
}

void OnStart()
{
   PrintFormat("TOV2_WIRE_START vectors=%d offline=1",TOV2_WIRE_VECTOR_COUNT);
   for(int i=0;i<TOV2_WIRE_VECTOR_COUNT;i++) Tov2WireRunVector(i);
   Tov2WireRunRequestMutations();
   Tov2WireRunRequestBounds();
   Tov2WireRunResponseMutations();
   if(tov2_wire_failures==0)
      PrintFormat("TOV2_WIRE_PASS checks=%d failures=0",tov2_wire_checks);
   else
      PrintFormat("TOV2_WIRE_FAIL checks=%d failures=%d",tov2_wire_checks,tov2_wire_failures);
}
