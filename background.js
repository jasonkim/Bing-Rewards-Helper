// Only load for bing.com domain
chrome.webNavigation.onCompleted.addListener(function(details) {
	chrome.pageAction.show(details.tabId);
}, {url: [{hostSuffix: "bing.com"}]});

chrome.pageAction.onClicked.addListener(function(tab) {
	perform(tab.id, tab.url);
	var fireEvery = 60; // minutes
	localStorage["bing_reward_tab_id"] = tab.id
	localStorage["bing_reward_tab_url"] = tab.url
	chrome.alarms.create({delayInMinutes: fireEvery, periodInMinutes: fireEvery});
	console.log("Scheduled next run");
});

chrome.alarms.onAlarm.addListener(function() {
	console.log("onAlarm fired");
	perform(parseInt(localStorage["bing_reward_tab_id"]), localStorage["bing_reward_tab_url"]);
});


var terms = [];
function getTerms() {
	if (terms.length == 0) {
		console.log("Getting terms");
		// Get a list of search terms
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "http://en.wikipedia.org/w/api.php?format=json&action=query&list=random&rnlimit=10&rnnamespace=0", false);
		xhr.onload = function() {
			var queries = JSON.parse(xhr.responseText).query.random;
			for (var k in queries)
				terms.push(queries[k].title);
		}
		xhr.send();
		console.log("Got terms");
	}
	return terms.pop();
}

function ticketRemaining(comm) {
	return comm.TicketCap - comm.TicketProgress
}

function urlrewards(comm) {
	console.log("Running urlrewards");
	// Active the other offer links
	var xhr = new XMLHttpRequest();
	xhr.open("HEAD", "http://www.bing.com" + comm.Message.destinationurl, false);
	try {
		xhr.send(null);
	} catch(e) {
		console.log("Error running urlrewards");
	}
}

function search(comm) {
	console.log("Running search");
	var searchParams = comm.Message.description.match(/\d+/g);
	var totalSearches = searchParams[1] * ticketRemaining(comm);

	for (i = 0; i < totalSearches; i++) {
		// Search away
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "http://www.bing.com/search?q=" + getTerms(), false);
		try {
			xhr.send(null);
		} catch(e) {
			console.log("Error running search");
		}
	}
}

function setMobileEnv() {
	console.log("Setting mobile");
	// Set mobile User-Agent
	if (typeof chrome.declarativeWebRequest != 'undefined') {
		chrome.declarativeWebRequest.onRequest.addRules([{
			conditions: [
				new chrome.declarativeWebRequest.RequestMatcher({
					url: {hostSuffix: "bing.com"}
				})
			],
			actions: [
				new chrome.declarativeWebRequest.SetRequestHeader({
					name: "User-Agent",
					value: "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.114 Mobile Safari/537.36"
				})
			]
		}]);
	}
	else {
		var listener;
		chrome.webRequest.onBeforeSendHeaders.addListener(
			listener = function (details) {
			for (var i = 0; i < details.requestHeaders.length; ++i) {
				if (details.requestHeaders[i].name === 'User-Agent') {
					details.requestHeaders[i].value = "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/34.0.1847.114 Mobile Safari/537.36"
				}
			}
			return {requestHeaders: details.requestHeaders};
			},
			{urls: ["*://www.bing.com/*"]},
			["blocking", "requestHeaders"]
		);
		return listener
	}
}

function unsetMobileEnv(listener) {
	console.log("Unsetting mobile");
	// Remove mobile User-Agent
	if (typeof chrome.declarativeWebRequest != 'undefined') {
		chrome.declarativeWebRequest.onRequest.removeRules();
	}
	else {
		chrome.webRequest.onBeforeSendHeaders.removeListener(listener);
	}
}

function perform(tab_id, tab_url) {
	// Insert spinner stylesheet
	chrome.tabs.insertCSS(tab_id, {"file": "spinner.css"});

	// Insert spinner javascript
	chrome.tabs.executeScript(tab_id, {"file": "spinner.js"});

	// Get current reward offers
	var offersXHR = new XMLHttpRequest();
	offersXHR.open("GET", "http://www.bing.com/rewardsapp/getoffers", false);
	offersXHR.onload = function() {
		var json = JSON.parse(offersXHR.responseText);
		if (json.ErrorDetail.ErrorCode == 0) {
			for (var i in json.Communications) {
				var comm = json.Communications[i];
				if (comm.State == "Active") {
					switch (comm.ActivityType) {
						case "search":
							// Check if is a mobile search
							if (comm.CommunicationId == "mobsrch01") {
								var listener = setMobileEnv();
								search(comm);
								unsetMobileEnv(listener);
							}
							else {
								search(comm);
							}
							break;
						case "urlreward":
							urlrewards(comm);
							break;
						default:
							break;
					}
				}
			}
		}
	}
	try{offersXHR.send(null);} catch(e){}

	// Refresh the page to see the new status
	chrome.tabs.update(tab_id, {"url": tab_url});
}