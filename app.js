const app = require('express')();
const http = require('http').Server(app);
const io = require('socket.io')(http);


let discussionTime = 5; //in seconds
let myInterval;
let roleActionTimer = 10; //15s for each role
let autoIdIncrementer = 0;
let playerCount = 0;
let playerDict = {};
let selectedRoles = []; //make sure we count the middle roles backward as such: [..., 3, 2, 1]
let finalPlayerOrder = []; //corresponds to shuffled selectedRoles
let roleOrder = ["Doppelgänger", "Werewolf", "Minion", "Mason", "Seer", "Robber", "Troublemaker", "Drunk", "Insomniac"]; //then Doppelgänger and Insomniac again
let roleIndex = 0;
let gameStatus = 0;

//maintain list of who joined in order and give leader status to first who joined
let partyLeader = "";
let playerQueue = [];

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function assignPlayersRandomly() {
	selectedRoles = shuffle(selectedRoles);
	finalPlayerOrder = [];
	var i = 0;
	for(const player in playerDict) {
		playerDict[player].voteCounter = 0;
		playerDict[player].role = selectedRoles[i];
		finalPlayerOrder.push(player);
		i++;
	}
	console.log('roles have been assigned:', playerDict);
}

function addPlayer(socket, data) {
	const socketId = socket.id;
	if(socketId in playerDict)
		return;
	
	var x = {
		'name': data.name,
		'autoId': autoIdIncrementer,
		'role': '',
		'ip': data.ip,
		'voteCounter': 0
	};
	playerDict[socketId] = x;
	console.log(playerDict);
	
	playerQueue.push(socketId);
	if(playerCount == 0) {
		partyLeader = socketId;
		io.emit("newPartyLeader", {'partyLeader': partyLeader });
	}
	
	playerCount += 1;
	autoIdIncrementer += 1;
	
	//update player list for everybody!
	io.emit("updatePlayerDict", playerDict);
	console.log("somebody is among us: ", "(", playerCount, ")");
	
	//let player know gameStatus
	socket.emit("updateGameStatus", {'gameStatus': gameStatus});
}

function deletePlayer(socket) {
	const socketId = socket.id;
	if(!(socketId in playerDict))
		return;
	
	console.log("user dropped...", socketId);
	delete playerDict[socketId];
	console.log(playerDict);
	playerCount -= 1;
	
	//make new party leader the next in queue that is still active
	for(var i = 0; i < playerQueue.length; i++) {
		if(playerQueue[i] in playerDict) {
			partyLeader = playerQueue[i];
			break;
		}
	}
	io.emit("playerLeave", playerDict);
	io.emit("newPartyLeader", {'partyLeader': partyLeader });
	console.log("somebody is no longer among us: ", "(", playerCount, ")");
	stopGame();
}

function stopGame() {
	roleIndex = 0;
	gameStatus = 0;
	
	clearInterval(myInterval);
	
	//reset game status and player roles
	io.emit("updateGameStatus", {'gameStatus': gameStatus});
	io.emit('tellPlayerRole', {'role':''});

	console.log('game stopped');
}

function updateRoles(sr) {
	console.log('new roles', sr);
	selectedRoles = sr;
	io.emit("updateRoles", selectedRoles);
}

function tellPlayerRoles() {
	for(const player in playerDict) {
		io.to(player).emit('tellPlayerRole', {'role': playerDict[player].role});
	}
}

//determines what renders on the players' screens depending on what point in the game we are in
function updateGameStatus() {
	gameStatus++;
	console.log('game enter phase', gameStatus);
	io.emit("updateGameStatus", {'gameStatus': gameStatus});
}

function sendWerewolfAction() {
	let wolfList = [];
	for(var i = 0; i < selectedRoles.length-3; i++) {
		if(selectedRoles[i] == 'Werewolf') {
			wolfList.push(finalPlayerOrder[i]);
		}
	}
	
	if(wolfList.length == 1) {
		//tell the player they are solo wolf and to pick a middle card
		io.to(wolfList[0]).emit('singleWerewolfResponse', {});
	}
	else if(wolfList.length == 2) {
		//tell the player who their partner is
		io.to(wolfList[0]).emit('doubleWerewolfResponse', {'partner': wolfList[1]});
		io.to(wolfList[1]).emit('doubleWerewolfResponse', {'partner': wolfList[0]});
	}
	else if(wolfList.length == 0) {
		console.log('there are no wolves among us');
	}
	else {
		console.log('too many wolves!');
	}
}

function sendMasonAction() {
	let masonList = [];
	for(var i = 0; i < selectedRoles.length-3; i++) {
		if(selectedRoles[i] == 'Mason') {
			masonList.push(finalPlayerOrder[i]);
		}
	}
	
	if(masonList.length == 1) {
		//tell the player they are solo wolf and to pick a middle card
		io.to(masonList[0]).emit('masonResponse', {'partner': 'Middle'});
	}
	else if(masonList.length == 2) {
		//tell the player who their partner is
		io.to(masonList[0]).emit('masonResponse', {'partner': masonList[1]});
		io.to(masonList[1]).emit('masonResponse', {'partner': masonList[0]});
	}
	else if(wolfList.length == 0) {
		console.log('there are no masons among us');
	}
	else {
		console.log('too many masons!');
	}
}

function promptNextNightAction() {
	
	while(roleIndex < roleOrder.length) {
		//skip if item is not in selectedRoles
		if(selectedRoles.includes(roleOrder[roleIndex]))
			break;
		roleIndex++;
	}
	
	if(roleIndex >= roleOrder.length) {
		clearInterval(myInterval);
		console.log('Begin day!');
		
		//start timer for final countdown
		//update gameStatus
		updateGameStatus(); //++
		io.emit("startDiscussionTimer", {'time': discussionTime});
		setTimeout(beginVote, discussionTime * 1000);
		
		
		return;
	}
	
	//I think it is trying to use a role that is not in the deck!!
	console.log('NEEEEXT: ', roleOrder[roleIndex]);
	
	//emit the current role to everybody, the actual person with that role may respond client-side
	console.log('current night action: ', roleOrder[roleIndex]);
	
	//must prompt werewolves with partner info first, before they can act
	let role = roleOrder[roleIndex];
	if(role == 'Werewolf') {
		sendWerewolfAction();
	}
	else if(role== 'Mason') {
		sendMasonAction();
	}
	
	//let everybody know who is acting now
	io.emit("doNightAction", {'role': roleOrder[roleIndex], 'time': roleActionTimer});
	//finish here, leaving roleIndex on the previous role for next time this function is called

	//do something when roleIndex = roleOrder.length
	roleIndex++;
}

function beginVote() {
	let voteTime = 10000;
	clearInterval(myInterval);
	updateGameStatus();
	console.log('Vote!');
	io.emit("startVoteTimer", {'time': 10});
	
	setTimeout(() => {
		console.log('GG');
		
		//get player(s) with most votes...
		let maxVoteCount = 0;
		let votedList = [];
		for(const player in playerDict) {
			if(playerDict[player].voteCounter > maxVoteCount) {
				maxVoteCount = playerDict[player].voteCounter;
				votedList = [];
				votedList.push(player);
			}
			else if(playerDict[player].voteCounter == maxVoteCount) {
				votedList.push(player);
			}
		}
		
		updateGameStatus();
		io.emit("review", {'votedList': votedList, 'playerDict': playerDict});
	}, 10000);
}


//CONNECT

io.on("connection", (socket) => {
	let previousId;
	const safeJoin = (currentId) => {
		socket.leave(previousId);
		socket.join(currentId);
		previousId = currentId;
	};
	
	//called when player sets username and joins
	socket.on("setPlayerData", data => {
		addPlayer(socket, data);
		io.emit("updateRoles", selectedRoles);
	});
	
	socket.on("setRoles", data => {
		updateRoles(data);
	});
	
	//disconnect :(
	socket.on('disconnect', data => {
		deletePlayer(socket);
	});
	
	//begin night phase!
	socket.on('startNightPhase', data => {
		roleIndex = 0;
		assignPlayersRandomly();
		updateGameStatus();
		tellPlayerRoles();
		
		//call repeating night prompts!!!
		promptNextNightAction();
		myInterval = setInterval(promptNextNightAction, roleActionTimer * 1000);
	});
	
	//leader force stop game
	socket.on('stopGame', data => {
		stopGame();
	});
	
	//recieve casted vote from a player
	socket.on('castVote', data => {
		console.log('data:', data);
		playerDict[data.vote].voteCounter++;
		//console.log('vote:', playerDict[data.player].voteCounter);
	});
	
	//RESPOND TO PLAYER ACTION SECTION
	
	
	socket.on('werewolfMiddle', data => {
		console.log(selectedRoles.slice(selectedRoles.length-3), data.middleIndex1);
		console.log('got the middle card for the wolf: ', selectedRoles[selectedRoles.length - data.middleIndex1]);
		socket.emit('werewolfMiddleResponse', {'middleRole1': selectedRoles[selectedRoles.length - data.middleIndex1]});
	});
	
	//send name of other mason
	socket.on('Mason', data => {
	});
	
	//send role of player's card, OR roles of 2 middle cards as requested - front end can limit the seer's selections...
	socket.on('Seer', data => {
		let selectionType = data.selectionType;
		if(selectionType == 'player') {
			let role = playerDict[data.player1].role;
			socket.emit('seerResponse', {'role': role});
		}
		else { //middle
			let middleRole1 = selectedRoles[selectedRoles.length - data.middleIndex1];
			let middleRole2 = selectedRoles[selectedRoles.length - data.middleIndex2];
			socket.emit('seerResponse', {'middleRole1': middleRole1, 'middleRole2': middleRole2, 'role': ''});
		}
	});
	
	//*send role of player's card they stole, and swap them here
	socket.on('Robber', data => {
		const player1 = data.player1;
		const player2 = socket.id; //original robber
		let role1 = playerDict[player1].role;
		let role2 = playerDict[player2].role;
		
		playerDict[player1].role = role2;
		playerDict[player2].role = role1;
		
		socket.emit('robberResponse', {'role': role1});
	});
	
	//*swap the two players' cards they selected
	socket.on('Troublemaker', data => {
		let player1 = data.player1;
		let player2 = data.player2;
		let role1 = playerDict[player1].role;
		let role2 = playerDict[player2].role;
		
		playerDict[player1].role = role2;
		playerDict[player2].role = role1;
		
		socket.emit('troublemakerResponse', {});
	});
	
	//*swap the middle card they selected with their own card
	socket.on('Drunk', data => {
		const socketId = socket.id;
		let middleIndex = data.middleIndex; //1-3
		let tmp = playerDict[socketId].role;
		playerDict[socketId].role = selectedRoles[selectedRoles.length - middleIndex];
		
		socket.emit('drunkResponse', {});
	});
	
	//show the player their own card
	socket.on('Insomniac', data => {
		const socketId = socket.id;
		socket.emit('insomniacResponse', {'role': playerDict[socketId].role});
	});
	
});

console.log('time to listen', playerCount);

http.listen(4444);