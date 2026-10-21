"""Discrete-event model of drainConcurrently (apps/gateway/src/background/telegram-update-drainer.ts @ main 66528457).
Validates that the serial claim loop (room = lanes - inflight, capped at ceil(lanes/bots)) reproduces the
batch-26 drain ceiling, then evaluates variants. Infinite backlog on 'driver'; 'rider' queue empty."""
import heapq,random,sys
def sim(policy,lanes=32,T=0.20,S=0.73,Sjit=0.35,bots=2,cap=100,dur=120,seed=1):
  rnd=random.Random(seed); t=0.0; inflight=[]; done=0; buf=0; claimed=0; drained_rider=False
  busy_area=0.0; last=0.0; trips=0; jobs_trip=0
  def svc(): return max(0.05,rnd.gauss(S,S*Sjit))
  def adv(nt):
    nonlocal t,busy_area,last,done
    while inflight and inflight[0]<=nt:
      e=heapq.heappop(inflight); busy_area+=len(inflight)*0; 
    t=nt
  # time-stepped event loop
  events=[]
  while t<dur:
    # sweep boundary
    if claimed>=cap: claimed=0; drained_rider=False
    # wait for a free lane
    while len(inflight)>=lanes:
      nt=heapq.heappop(inflight); busy_area+=(nt-t)*(len(inflight)+1); t=nt; done+=1
    if buf>0:
      buf-=1; claimed+=1; heapq.heappush(inflight,t+svc()); continue
    # claim trip
    if not drained_rider:
      room=0; drained_rider=True
    else:
      if policy=='main': room=min(max(1,lanes-len(inflight)),-(-lanes//bots),max(1,cap-claimed))
      elif policy=='fixed': room=min(-(-lanes//bots),max(1,cap-claimed))
      elif policy=='lanes': room=min(lanes,max(1,cap-claimed))
    end=t+T; trips+=1
    while inflight and inflight[0]<=end:
      nt=heapq.heappop(inflight); busy_area+=(nt-t)*(len(inflight)+1); t=nt; done+=1
    busy_area+=(end-t)*len(inflight); t=end
    if room==0: continue
    jobs_trip+=room
    buf=room
  return dict(policy=policy,thr=done/dur,mean_inservice=busy_area/dur,jobs_per_trip=jobs_trip/max(1,trips))
for p in ['main','fixed','lanes']:
  for T,S in [(0.20,0.73),(0.065,0.52)]:
    r=sim(p,T=T,S=S); print(p,'T=%.3f S=%.2f'%(T,S),{k:round(v,1) if isinstance(v,float) else v for k,v in r.items()})

def sim_pipe(lanes=32,T=0.20,S=0.73,Sjit=0.35,bots=2,cap=100,dur=120,seed=1,low=None):
  """Prefetch: at most one claim trip outstanding, issued (not awaited) whenever buffered+pending < lanes//bots.
  Buffer capped at ceil(lanes/bots); sweep cap respected (buffered counts against it)."""
  rnd=random.Random(seed); per=-(-lanes//bots); low=per if low is None else low
  t=0.0; inflight=[]; done=0; buf=0; trip_end=None; trip_room=0; claimed=0; area=0.0; trips=0;jt=0
  def svc(): return max(0.05,rnd.gauss(S,S*Sjit))
  wasted_pending=True
  def step_to(nt):
    nonlocal t,area,done
    while inflight and inflight[0]<=nt:
      x=heapq.heappop(inflight); area+=(x-t)*(len(inflight)+1); t=x; done+=1
    area+=(nt-t)*len(inflight); t=nt
  while t<dur:
    if claimed>=cap and buf==0 and trip_end is None: claimed=0; wasted_pending=True
    if trip_end is None and buf<low and claimed+buf<cap:
      trips+=1; trip_end=t+T
      if wasted_pending: trip_room=0; wasted_pending=False
      else: trip_room=min(per,cap-claimed-buf)
    if buf>0 and len(inflight)<lanes:
      buf-=1; claimed+=1; heapq.heappush(inflight,t+svc()); continue
    # wait for next event: lane free or trip end
    nxt=[x for x in [inflight[0] if (len(inflight)>=lanes and inflight) else None, trip_end] if x is not None]
    if not nxt: nxt=[inflight[0]] if inflight else [t+0.01]
    ne=min(nxt); step_to(ne)
    if trip_end is not None and t>=trip_end-1e-12: buf+=trip_room; jt+=trip_room; trip_end=None
  return dict(policy='pipelined',thr=done/dur,mean_inservice=area/dur,jobs_per_trip=jt/max(1,trips))
for T,S in [(0.20,0.73),(0.065,0.52),(0.40,0.9)]:
  print('pipelined T=%.3f S=%.2f'%(T,S),{k:round(v,1) if isinstance(v,float) else v for k,v in sim_pipe(T=T,S=S).items()},
        'main',round(sim('main',T=T,S=S)['thr'],1),'fixed',round(sim('fixed',T=T,S=S)['thr'],1))
