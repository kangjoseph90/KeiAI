# Measured
SRV_TOMB=340; SRV_LIVE=1175          # server bytes/row incl. indexes (live = conservative small message)
CLI_TOMB=174                         # client SQLite bytes/row
WIRE_TOMB=424; WIRE_LIVE=1160        # JSON bytes per row in Pull responses
PAGE=200
RTT=0.08; MBPS=20e6/8                # network assumption: 80 ms RTT, 20 Mbps
CLIENT_US=80e-6                      # per-tombstone decode+write on the client (decode measured 30us; write estimated)
personas = {  # messages/day, active days/yr, share of messages eventually deleted
  'light':  (40, 200, 0.20),
  'heavy':  (200, 365, 0.50),
  'power':  (800, 365, 0.70),
}
def pull_seconds(tomb, live):
    rows = tomb + live; pages = -(-rows // PAGE)
    return pages*RTT + (tomb*WIRE_TOMB + live*WIRE_LIVE)/MBPS + tomb*CLIENT_US
print(f"{'persona':7} {'yrs':>3} {'tombs':>9} {'live':>8} {'srv tomb MB':>11} {'srv live MB':>11} {'client MB':>9} {'+pull s (no GC)':>15} {'+pull s (30d GC)':>16}")
for name,(per_day,days,deleted) in personas.items():
    per_year=per_day*days
    for yrs in (1,3,5):
        tomb=int(per_year*deleted*yrs); live=int(per_year*(1-deleted)*yrs)
        gc_tomb=int(per_year*deleted/12)  # roughly 30 days retained
        extra=pull_seconds(tomb,live)-pull_seconds(0,live)
        extra_gc=pull_seconds(gc_tomb,live)-pull_seconds(0,live)
        print(f"{name:7} {yrs:>3} {tomb:>9,} {live:>8,} {tomb*SRV_TOMB/1e6:>11.0f} {live*SRV_LIVE/1e6:>11.0f} {tomb*CLI_TOMB/1e6:>9.0f} {extra:>15.0f} {extra_gc:>16.0f}")
# server population
for users in (100,1000,10000):
    mix={'light':0.70,'heavy':0.25,'power':0.05}
    t=sum(users*share*personas[p][0]*personas[p][1]*personas[p][2] for p,share in mix.items())
    print(f"{users:>6} users: {t/1e6:.1f}M tombstones/yr = {t*SRV_TOMB/1e9:.1f} GB/yr server (5y: {5*t*SRV_TOMB/1e9:.0f} GB)")
