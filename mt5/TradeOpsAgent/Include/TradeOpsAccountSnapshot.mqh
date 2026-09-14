#ifndef TRADEOPS_ACCOUNT_SNAPSHOT_MQH
#define TRADEOPS_ACCOUNT_SNAPSHOT_MQH
#include "TradeOpsCaptureCodec.mqh"

class CTov2AccountSnapshot
{
private:
   string m_expected;
   bool m_has_complete,m_stopped;
   Tov2CaptureExposure m_complete;
   bool SameFixed(const Tov2CaptureFixed &a,const Tov2CaptureFixed &b)
   {return a.scale==b.scale && a.value==b.value;}
   bool SameReading(const Tov2CaptureReading &a,const Tov2CaptureReading &b)
   {return a.reason==b.reason && SameFixed(a.fixed,b.fixed);}
   bool StablePosition(const Tov2CapturePosition &a,const Tov2CapturePosition &b)
   {
      return a.ticket==b.ticket && a.position_id==b.position_id && a.symbol==b.symbol && a.side==b.side &&
         SameFixed(a.volume,b.volume) && SameReading(a.entry_price,b.entry_price) &&
         SameReading(a.sl,b.sl) && SameReading(a.tp,b.tp);
   }
   bool StableOrder(const Tov2CaptureOrder &a,const Tov2CaptureOrder &b)
   {
      return a.ticket==b.ticket && a.symbol==b.symbol && a.type==b.type && a.state==b.state &&
         SameFixed(a.volume_initial,b.volume_initial) && SameFixed(a.volume_current,b.volume_current) &&
         SameReading(a.price,b.price) && SameReading(a.stop_limit_price,b.stop_limit_price) &&
         SameReading(a.sl,b.sl) && SameReading(a.tp,b.tp);
   }
   bool Membership(const Tov2CaptureExposure &a,const Tov2CaptureExposure &b)
   {
      if(a.positions_size!=b.positions_size || a.orders_size!=b.orders_size) return false;
      for(int i=0;i<a.positions_size;i++)
      {
         bool found=false;
         for(int j=0;j<b.positions_size;j++)
            if(StablePosition(a.positions[i],b.positions[j])) { found=true;break; }
         if(!found) return false;
      }
      for(int i=0;i<a.orders_size;i++)
      {
         bool found=false;
         for(int j=0;j<b.orders_size;j++) if(StableOrder(a.orders[i],b.orders[j])) {found=true;break;}
         if(!found) return false;
      }
      return true;
   }
public:
   CTov2AccountSnapshot(const string expected_fingerprint)
   {m_expected=expected_fingerprint;m_stopped=false;m_has_complete=false;Tov2CaptureClearExposure(m_complete);}
   // Reset discards cached private data; the configured account and stopped state remain pinned.
   void Reset() {m_has_complete=false;Tov2CaptureClearExposure(m_complete);}
   bool LastComplete(Tov2CaptureExposure &out)
   {Tov2CaptureClearExposure(out);if(!m_has_complete || m_stopped) return false;out=m_complete;return true;}
   Tov2CaptureResult Capture(ITov2CaptureBroker *broker,Tov2CaptureAccount &account,Tov2CaptureExposure &exposure)
   {
      Tov2CaptureClearAccount(account);Tov2CaptureClearExposure(exposure);
      if(m_stopped) return TOV2_CAPTURE_IDENTITY_CHANGED;
      if(CheckPointer(broker)==POINTER_INVALID || !Tov2Digest(m_expected)) return TOV2_CAPTURE_READ_FAILED;
      string before="",after="";Tov2CaptureDisplay display,display_after;
      Tov2CaptureResult identity=broker.Identity(before,display);
      if(identity!=TOV2_CAPTURE_OK || !Tov2Digest(before) || !Tov2CaptureDisplayValid(display))
      {Reset();return TOV2_CAPTURE_READ_FAILED;}
      if(before!=m_expected) {Reset();m_stopped=true;return TOV2_CAPTURE_IDENTITY_CHANGED;}
      // Missing clocks retain the prior complete cache but return no newly timestamped data.
      long utc=0,time=0;
      if(broker.Clocks(utc,time)!=TOV2_CAPTURE_OK || !Tov2Counter(utc,1) || !Tov2Counter(time,1))
         return TOV2_CAPTURE_READ_FAILED;
      Tov2CaptureResult ar=broker.Account(account),er=broker.Exposure(exposure);
      account.observed_at_utc_seconds=utc;account.observed_at_broker_msc=time;
      exposure.observed_at_utc_seconds=utc;exposure.observed_at_broker_msc=time;
      if(ar!=TOV2_CAPTURE_OK || account.status!="COMPLETE" || !Tov2CaptureAccountValid(account,display.currency_scale))
      {
         Tov2CaptureClearAccount(account);account.observed_at_utc_seconds=utc;account.observed_at_broker_msc=time;
         ar=TOV2_CAPTURE_READ_FAILED;
      }
      if(er==TOV2_CAPTURE_OK)
      {
         Tov2CaptureExposure second;Tov2CaptureResult sr=broker.Exposure(second);
         second.observed_at_utc_seconds=utc;second.observed_at_broker_msc=time;
         if(sr!=TOV2_CAPTURE_OK || exposure.status!="COMPLETE" || second.status!="COMPLETE" || !Tov2CaptureExposureValid(exposure,display.currency_scale) ||
            !Tov2CaptureExposureValid(second,display.currency_scale) || !Membership(exposure,second))
            er=sr==TOV2_CAPTURE_LIMIT_EXCEEDED?sr:TOV2_CAPTURE_READ_FAILED;
      }
      if(er!=TOV2_CAPTURE_OK) Tov2CaptureFailExposure(exposure,er);
      identity=broker.Identity(after,display_after);
      if(identity!=TOV2_CAPTURE_OK || !Tov2CaptureDisplayValid(display_after) || !Tov2Digest(after))
      {Tov2CaptureClearAccount(account);Tov2CaptureClearExposure(exposure);Reset();return TOV2_CAPTURE_READ_FAILED;}
      if(after!=m_expected || after!=before)
      {Tov2CaptureClearAccount(account);Tov2CaptureClearExposure(exposure);Reset();m_stopped=true;return TOV2_CAPTURE_IDENTITY_CHANGED;}
      if(er==TOV2_CAPTURE_OK) {m_complete=exposure;m_has_complete=true;}
      if(er!=TOV2_CAPTURE_OK) return er;
      return ar;
   }
};
#endif
