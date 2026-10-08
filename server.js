'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const MAX_SEATS = 6;
const INITIAL_BALANCE = 1000;
const DISCONNECT_GRACE_MS = 90000;
const TURN_MS = 30000;
const OFFLINE_TURN_MS = 8000;
const SIDE_MAX = 500;
let soft17Hit = false;
let turnDeadline = null;
let hostToken = null;
const clients = new Map(); // token -> { ws, name, bankroll, bet, seat, lastSeen }
let shoe = [];
let phase = 'bet';
let dealer = [];
let hands = [];
let turn = -1;
let round = 0;
let status = 'Take a seat, place your bets, and start the round.';
let event = 0;
let serial = Promise.resolve();
const suits = ['♠','♥','♦','♣'];
const shuffle = () => { shoe=[]; for(let d=0;d<6;d++)for(const s of suits)for(let r=1;r<=13;r++)shoe.push({r,s});for(let i=shoe.length-1;i>0;i--){const j=crypto.randomInt(i+1); [shoe[i],shoe[j]]=[shoe[j],shoe[i]];} };
const draw=()=>{if(shoe.length<24)shuffle(); return shoe.pop();};
const value=(cards)=>{let n=0,aces=0;for(const c of cards){if(c.r===1){n++;aces++;}else n+=Math.min(c.r,10);}while(aces>0&&n+10<=21){n+=10;aces--;}return n;};
const blackjack=cards=>cards.length===2&&value(cards)===21;
const soft=(cards)=>{let n=0,aces=0;for(const c of cards){if(c.r===1){n++;aces++;}else n+=Math.min(c.r,10);}return aces>0&&n+10<=21;};
const suitColor=s=>s==='♥'||s==='♦'?'red':'black';
function pairPayout(a,b){if(a.r!==b.r)return {name:'No pair',mult:0};if(a.s===b.s)return {name:'Perfect pair',mult:25};if(suitColor(a.s)===suitColor(b.s))return {name:'Colored pair',mult:12};return {name:'Mixed pair',mult:6};}
function twentyOneThree(a,b,c){
 const cs=[a,b,c],ranks=cs.map(x=>x.r),sameSuit=cs.every(x=>x.s===a.s),sameRank=ranks.every(x=>x===a.r),counts=new Map();ranks.forEach(r=>counts.set(r,(counts.get(r)||0)+1));const sorted=[...ranks].sort((x,y)=>x-y);const straight=(sorted[0]+1===sorted[1]&&sorted[1]+1===sorted[2])||JSON.stringify(sorted)==='[1,12,13]';
 if(sameSuit&&straight)return {name:'Straight flush',mult:40};if(sameRank)return {name:'Three of a kind',mult:30};if(straight)return {name:'Straight',mult:10};if(sameSuit)return {name:'Flush',mult:5};if([...counts.values()].some(x=>x===3))return {name:'Three of a kind',mult:30};return {name:'No match',mult:0};
}
function isDealerHit(cards){const total=value(cards);return total<17||(total===17&&soft17Hit&&soft(cards));}
function ensureHost(){const host=clients.get(hostToken);if(host?.seat!==null&&host?.ws?.readyState===WebSocket.OPEN)return;hostToken=(seatList().find(c=>c.ws?.readyState===WebSocket.OPEN)||seatList()[0])?.token||null;}
function setTurnDeadline(){turnDeadline=turn>=0?Date.now()+TURN_MS:null;}

const seatList=()=>Array.from(clients.values()).filter(c=>c.seat!==null).sort((a,b)=>a.seat-b.seat);
function publicState(forToken){
 ensureHost();
 const viewer=clients.get(forToken);
 return {type:'state',phase,round,status,event,turn, maxSeats:MAX_SEATS,viewer:viewer?{name:viewer.name,seat:viewer.seat,bankroll:viewer.bankroll,bet:viewer.bet,sidePair:viewer.sidePair||0,side21:viewer.side21||0,isHost:viewer.token===hostToken}:null,soft17Hit,turnDeadline,turnMs:TURN_MS,
 seats:Array.from({length:MAX_SEATS},(_,i)=>{const c=seatList().find(v=>v.seat===i);return c?{seat:i,name:c.name,bankroll:c.bankroll,bet:c.bet,sidePair:c.sidePair||0,side21:c.side21||0,isHost:c.token===hostToken,online:!!(c.ws&&c.ws.readyState===WebSocket.OPEN)}:{seat:i,name:null};}),
 dealer:dealer.map((c,i)=>phase==='play'&&i===1?null:c),dealerScore:dealer.length?(phase==='play'?value([dealer[0]]):value(dealer)):null,
 hands:hands.map(h=>({seat:h.seat,name:h.name,cards:h.cards,bet:h.bet,result:h.result,number:h.number,score:value(h.cards),natural:h.natural,sideResults:h.sideResults||[]}))};
}
function broadcast(){event++;for(const [token,c] of clients){if(c.ws?.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify(publicState(token)));}}
function send(ws,kind,message){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:kind,message}));}
function findActiveTurn(start){for(let i=start;i<hands.length;i++){const h=hands[i];if(!h.done&&!h.natural&&value(h.cards)<21)return i;}return -1;}
function settle(){
 phase='end';turn=-1;turnDeadline=null;
 if(hands.some(h=>!h.natural&&value(h.cards)<=21))while(isDealerHit(dealer))dealer.push(draw());
 const dealerNatural=blackjack(dealer),dv=value(dealer);
 let wins=0,losses=0,pushes=0;
 for(const h of hands){const player=seatList().find(x=>x.seat===h.seat); let payout=0;
 if(value(h.cards)>21){h.result='BUST';losses++;}
 else if(h.natural&&dealerNatural){h.result='PUSH';payout=h.bet;pushes++;}
 else if(h.natural){h.result='BLACKJACK';payout=h.bet*2.5;wins++;}
 else if(dealerNatural){h.result='LOSE';losses++;}
 else if(dv>21||value(h.cards)>dv){h.result='WIN';payout=h.bet*2;wins++;}
 else if(value(h.cards)===dv){h.result='PUSH';payout=h.bet;pushes++;}
 else{h.result='LOSE';losses++;}
 if(player)player.bankroll+=payout;
 }
 status=`Round over: ${wins} winning hand${wins===1?'':'s'}, ${pushes} pushes, ${losses} losing hand${losses===1?'':'s'}.`;
 broadcast();
}
function advance(){turn=findActiveTurn(turn+1);if(turn<0){settle();return;}setTurnDeadline();const h=hands[turn];status=`${h.name}, your move${h.number>1?' (hand '+h.number+')':''}.`;broadcast();}
function newRound(){phase='bet'; dealer=[];hands=[];turn=-1;turnDeadline=null;status='Place bets for the next round.';broadcast();}
function startRound(c){
 if(phase!=='bet')throw Error('Wait for the next betting round.');
 const players=seatList().filter(p=>p.bet>=5&&p.bankroll>=p.bet+(p.sidePair||0)+(p.side21||0));
 if(!players.length)throw Error('At least one seated player needs a $5+ bet.');
 round++; if(shoe.length<85)shuffle(); phase='play';dealer=[];hands=[];
 for(const p of players){p.bankroll-=p.bet+(p.sidePair||0)+(p.side21||0);hands.push({seat:p.seat,name:p.name,number:1,bet:p.bet,cards:[],done:false,natural:false,result:'',sideResults:[]});}
 for(const h of hands)h.cards.push(draw()); dealer.push(draw());for(const h of hands)h.cards.push(draw());dealer.push(draw());
 for(const h of hands){h.natural=blackjack(h.cards);h.done=h.natural;
  const p=players.find(x=>x.seat===h.seat);
  for(const [key,wager,assessment] of [['Perfect Pairs',p.sidePair||0,pairPayout(h.cards[0],h.cards[1])],['21+3',p.side21||0,twentyOneThree(h.cards[0],h.cards[1],dealer[0])]]){
   if(!wager)continue;const payout=wager*(assessment.mult+1)*(assessment.mult>0?1:0);p.bankroll+=payout;
   h.sideResults.push({type:key,name:assessment.name,wager,mult:assessment.mult,payout});
  }
 }
 if(blackjack(dealer)){settle();return;}
 turn=-1;advance();
}
function act(c,action){
 if(phase!=='play')throw Error('No live turn.');
 const h=hands[turn];if(!h||h.seat!==c.seat)throw Error('Wait for your turn.');
 if(h.done)throw Error('This hand is finished.');
 switch(action){
 case 'hit':h.cards.push(draw());if(value(h.cards)>=21){h.done=true;advance();}else{setTurnDeadline();status=`${h.name} hits — ${value(h.cards)}.`;broadcast();}break;
 case 'stand':h.done=true;advance();break;
 case 'double':if(h.cards.length!==2||c.bankroll<h.bet)throw Error('Cannot double this hand.');c.bankroll-=h.bet;h.bet*=2;h.cards.push(draw());h.done=true;advance();break;
 case 'split':{
 const same=hands.filter(x=>x.seat===c.seat).length;
 if(h.cards.length!==2||h.cards[0].r!==h.cards[1].r||same>=4||c.bankroll<h.bet)throw Error('Cannot split this hand.');
 c.bankroll-=h.bet;const ace=h.cards[0].r===1;const second=h.cards.pop();h.cards.push(draw());const nh={seat:h.seat,name:h.name,number:same+1,bet:h.bet,cards:[second,draw()],done:ace,natural:false,result:''};h.done=ace||value(h.cards)>=21;hands.splice(turn+1,0,nh);
 if(h.done)advance();else{status=`${h.name} splits. Continue hand ${h.number}.`;broadcast();}break;
 }
 default:throw Error('Unknown play.');
 }
}
function handle(c,m){
 if(typeof m!=='object'||m===null)throw Error('Invalid message.');
 if(m.type==='join'){
  if(c.seat!==null)throw Error('You are already seated.');
  if(phase==='play')throw Error('Join when the current round ends.');
  const wanted=Number(m.seat);
  if(!Number.isInteger(wanted)||wanted<0||wanted>=MAX_SEATS||seatList().some(x=>x.seat===wanted))throw Error('Seat unavailable.');
  c.seat=wanted;c.bet=25;c.name=(String(m.name||'').trim().slice(0,24).replace(/[<>]/g,'')||`Player ${wanted+1}`);if(!hostToken)hostToken=c.token;status=`${c.name} joined seat ${wanted+1}.`;broadcast();return;
 }
 if(m.type==='leave'){
  if(phase==='play'&&hands.some(h=>h.seat===c.seat))throw Error('Finish your round before leaving.');
  c.seat=null;c.bet=25;c.sidePair=0;c.side21=0;ensureHost();status='A seat is available.';broadcast();return;
 }
 if(m.type==='sidebet'){
  if(phase!=='bet'||c.seat===null)throw Error('Side bets are only available before a round.');
  const pair=Number(m.pair),plus=Number(m.plus);
  if(!Number.isInteger(pair)||!Number.isInteger(plus)||pair<0||plus<0||pair>SIDE_MAX||plus>SIDE_MAX||pair+plus+c.bet>c.bankroll)throw Error('Side bets must be affordable whole-dollar amounts, up to $500 each.');
  c.sidePair=pair;c.side21=plus;broadcast();return;
 }
 if(m.type==='settings'){
  if(c.token!==hostToken||c.seat===null)throw Error('Only the table host can change rules.');
  if(phase==='play')throw Error('Change rules between rounds.');
  if(typeof m.soft17Hit!=='boolean')throw Error('Invalid rule.');
  soft17Hit=m.soft17Hit;status=`Dealer now ${soft17Hit?'hits':'stands'} on soft 17.`;broadcast();return;
 }
 if(m.type==='kick'){
  if(c.token!==hostToken||c.seat===null)throw Error('Only the table host can remove players.');
  if(phase==='play')throw Error('Players can only be removed between rounds.');
  const target=seatList().find(x=>x.seat===Number(m.seat));
  if(!target||target.token===c.token)throw Error('Select another occupied seat.');
  target.seat=null;target.bet=25;target.sidePair=0;target.side21=0;status=`${target.name} was removed from the table.`;broadcast();return;
 }
 if(m.type==='bet'){
  if(phase!=='bet'||c.seat===null)throw Error('Betting is not open.');
  const bet=Number(m.amount);if(!Number.isInteger(bet)||bet<0||bet>5000||bet+(c.sidePair||0)+(c.side21||0)>c.bankroll)throw Error('Bet must be an affordable whole dollar amount.');
  c.bet=bet;broadcast();return;
 }
 if(m.type==='start'){if(c.seat===null)throw Error('Take a seat first.');startRound(c);return;}
 if(m.type==='action'){act(c,String(m.action));return;}
 if(m.type==='next'){if(phase!=='end')throw Error('Current round has not ended.');if(c.seat===null)throw Error('Take a seat first.');newRound();return;}
 if(m.type==='reset'){if(phase==='play')throw Error('Reset between rounds.');c.bankroll=INITIAL_BALANCE;c.sidePair=0;c.side21=0;if(c.bet>c.bankroll)c.bet=25;broadcast();return;}
 throw Error('Unknown command.');
}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
const httpServer=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(__dirname,'public',pathname==='/'?'index.html':pathname.slice(1));
 if(!file.startsWith(path.join(__dirname,'public')+path.sep)&&file!==path.join(__dirname,'public','index.html')){res.writeHead(403);res.end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);});
});
const wss=new WebSocketServer({server:httpServer,path:'/live',maxPayload:4096});
wss.on('connection',ws=>{
 let c=null;
 ws.on('message',raw=>{
  try{
   const m=JSON.parse(String(raw));
   if(!c){
    if(m.type!=='hello'||typeof m.token!=='string'||!/^[a-zA-Z0-9_-]{20,90}$/.test(m.token)){send(ws,'error','Invalid identity. Reload the site.');ws.close();return;}
    c=clients.get(m.token);
    if(!c){c={token:m.token,name:'',seat:null,bet:25,bankroll:INITIAL_BALANCE,sidePair:0,side21:0,ws:null,lastSeen:Date.now()};clients.set(m.token,c);}
    if(c.ws&&c.ws!==ws)c.ws.close();c.ws=ws;c.lastSeen=Date.now();broadcast();return;
   }
   if(c.ws!==ws)return;
   serial=serial.then(()=>handle(c,m)).catch(e=>send(ws,'error',e.message));
  }catch(e){send(ws,'error',e.message);}
 });
 ws.on('close',()=>{if(c&&c.ws===ws){c.ws=null;c.lastSeen=Date.now();if(phase==='play'&&hands[turn]?.seat===c.seat)turnDeadline=Math.min(turnDeadline||Infinity,Date.now()+OFFLINE_TURN_MS);broadcast();}});
});
setInterval(()=>{let changed=false;for(const [token,c] of clients){if(!c.ws&&Date.now()-c.lastSeen>DISCONNECT_GRACE_MS){if(phase!=='play'||!hands.some(h=>h.seat===c.seat)){clients.delete(token);changed=true;}}}if(changed)broadcast();},15000).unref();
setInterval(()=>{if(phase==='play'&&turn>=0){const h=hands[turn];const player=seatList().find(x=>x.seat===h.seat);if(player?.ws?.readyState!==WebSocket.OPEN&&turnDeadline>Date.now()+OFFLINE_TURN_MS)turnDeadline=Date.now()+OFFLINE_TURN_MS;if(turnDeadline&&Date.now()>=turnDeadline){h.done=true;status=`${h.name} automatically stands (turn expired).`;advance();}}},1000).unref();
shuffle();
if(require.main===module)httpServer.listen(PORT,()=>console.log(`Casino Avery on port ${PORT}`));
module.exports={httpServer,value,blackjack};
