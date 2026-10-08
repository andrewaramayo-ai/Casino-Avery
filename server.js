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
const seatList=()=>Array.from(clients.values()).filter(c=>c.seat!==null).sort((a,b)=>a.seat-b.seat);
function publicState(forToken){
 const viewer=clients.get(forToken);
 return {type:'state',phase,round,status,event,turn, maxSeats:MAX_SEATS,viewer:viewer?{name:viewer.name,seat:viewer.seat,bankroll:viewer.bankroll,bet:viewer.bet}:null,
 seats:Array.from({length:MAX_SEATS},(_,i)=>{const c=seatList().find(v=>v.seat===i);return c?{seat:i,name:c.name,bankroll:c.bankroll,bet:c.bet,online:!!(c.ws&&c.ws.readyState===WebSocket.OPEN)}:{seat:i,name:null};}),
 dealer:dealer.map((c,i)=>phase==='play'&&i===1?null:c),dealerScore:dealer.length?(phase==='play'?value([dealer[0]]):value(dealer)):null,
 hands:hands.map(h=>({seat:h.seat,name:h.name,cards:h.cards,bet:h.bet,result:h.result,number:h.number,score:value(h.cards),natural:h.natural}))};
}
function broadcast(){event++;for(const [token,c] of clients){if(c.ws?.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify(publicState(token)));}}
function send(ws,kind,message){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:kind,message}));}
function findActiveTurn(start){for(let i=start;i<hands.length;i++){const h=hands[i];if(!h.done&&!h.natural&&value(h.cards)<21)return i;}return -1;}
function settle(){
 phase='end';turn=-1;
 if(hands.some(h=>!h.natural&&value(h.cards)<=21))while(value(dealer)<17)dealer.push(draw());
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
function advance(){turn=findActiveTurn(turn+1);if(turn<0){settle();return;}const h=hands[turn];status=`${h.name}, your move${h.number>1?' (hand '+h.number+')':''}.`;broadcast();}
function newRound(){phase='bet'; dealer=[];hands=[];turn=-1;status='Place bets for the next round.';broadcast();}
function startRound(c){
 if(phase!=='bet')throw Error('Wait for the next betting round.');
 const players=seatList().filter(p=>p.bet>=5&&p.bankroll>=p.bet);
 if(!players.length)throw Error('At least one seated player needs a $5+ bet.');
 round++; if(shoe.length<85)shuffle(); phase='play';dealer=[];hands=[];
 for(const p of players){p.bankroll-=p.bet;hands.push({seat:p.seat,name:p.name,number:1,bet:p.bet,cards:[],done:false,natural:false,result:''});}
 for(const h of hands)h.cards.push(draw()); dealer.push(draw());for(const h of hands)h.cards.push(draw());dealer.push(draw());
 for(const h of hands){h.natural=blackjack(h.cards);h.done=h.natural;}
 if(blackjack(dealer)){settle();return;}
 turn=-1;advance();
}
function act(c,action){
 if(phase!=='play')throw Error('No live turn.');
 const h=hands[turn];if(!h||h.seat!==c.seat)throw Error('Wait for your turn.');
 if(h.done)throw Error('This hand is finished.');
 switch(action){
 case 'hit':h.cards.push(draw());if(value(h.cards)>=21){h.done=true;advance();}else{status=`${h.name} hits — ${value(h.cards)}.`;broadcast();}break;
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
  c.seat=wanted;c.bet=25;c.name=(String(m.name||'').trim().slice(0,24).replace(/[<>]/g,'')||`Player ${wanted+1}`);status=`${c.name} joined seat ${wanted+1}.`;broadcast();return;
 }
 if(m.type==='leave'){
  if(phase==='play'&&hands.some(h=>h.seat===c.seat))throw Error('Finish your round before leaving.');
  c.seat=null;c.bet=25;status='A seat is available.';broadcast();return;
 }
 if(m.type==='bet'){
  if(phase!=='bet'||c.seat===null)throw Error('Betting is not open.');
  const bet=Number(m.amount);if(!Number.isInteger(bet)||bet<0||bet>5000||bet>c.bankroll)throw Error('Bet must be an affordable whole dollar amount.');
  c.bet=bet;broadcast();return;
 }
 if(m.type==='start'){if(c.seat===null)throw Error('Take a seat first.');startRound(c);return;}
 if(m.type==='action'){act(c,String(m.action));return;}
 if(m.type==='next'){if(phase!=='end')throw Error('Current round has not ended.');if(c.seat===null)throw Error('Take a seat first.');newRound();return;}
 if(m.type==='reset'){if(phase==='play')throw Error('Reset between rounds.');c.bankroll=INITIAL_BALANCE;if(c.bet>c.bankroll)c.bet=25;broadcast();return;}
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
    if(!c){c={token:m.token,name:'',seat:null,bet:25,bankroll:INITIAL_BALANCE,ws:null,lastSeen:Date.now()};clients.set(m.token,c);}
    if(c.ws&&c.ws!==ws)c.ws.close();c.ws=ws;c.lastSeen=Date.now();broadcast();return;
   }
   if(c.ws!==ws)return;
   serial=serial.then(()=>handle(c,m)).catch(e=>send(ws,'error',e.message));
  }catch(e){send(ws,'error',e.message);}
 });
 ws.on('close',()=>{if(c&&c.ws===ws){c.ws=null;c.lastSeen=Date.now();broadcast();}});
});
setInterval(()=>{let changed=false;for(const [token,c] of clients){if(!c.ws&&Date.now()-c.lastSeen>DISCONNECT_GRACE_MS){if(phase!=='play'||!hands.some(h=>h.seat===c.seat)){clients.delete(token);changed=true;}}}if(changed)broadcast();},15000).unref();
shuffle();
if(require.main===module)httpServer.listen(PORT,()=>console.log(`Casino Avery on port ${PORT}`));
module.exports={httpServer,value,blackjack};
