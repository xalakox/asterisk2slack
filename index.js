
const fs = require('fs');
const request = require('request-promise-native');
const moment = require('moment')
const exec = require('child_process').exec;

const logsPath = process.env.LOGSPATH || '/var/log/asterisk';
const slackWH = process.env.SLACK_WEBHOOK;

// you should the filenames to be monitored in order to avoid duplicate events
const monitorCatalog = {
  'queue_log': {
    'ENTERQUEUE': {
      text: ({ param2, epoch }) => `*Incoming* call from ${param2} ${moment((~~epoch)*1e3).fromNow()}.`
    },
    'CONNECT': {
      text: ({ channel, epoch }) => `Call *picked up* by ${channel} ${moment((~~epoch)*1e3).fromNow()}.`
    },
    'COMPLETECALLER': {
      text: ({ channel, epoch }) => `*Caller* hanged up a call with ${channel} ${moment((~~epoch)*1e3).fromNow()}.`
    },
    'COMPLETEAGENT': {
      text: ({ channel, epoch }) => `${channel} *hanged up* a call ${moment((~~epoch)*1e3).fromNow()}.`
    },
  }
};
const fileStatus = {};
Object.keys(monitorCatalog).forEach(key => fileStatus[key] = []);

const execPromise = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
          reject(error);
          return;
      }
        resolve(stdout.trim().split('\n'));
    });
  });
}

const arr_diff = (a1, a2) => {
  var a = [], diff = [];
  for (var i = 0; i < a1.length; i++) {
      a[a1[i]] = true;
  }
  for (var i = 0; i < a2.length; i++) {
      if (a[a2[i]]) {
          delete a[a2[i]];
      } else {
          a[a2[i]] = true;
      }
  }
  for (var k in a) {
      diff.push(k);
  }
  return diff;
}

const processEvents = async ({filename, events}) => {
  if (events.length == 0) return;
  switch (filename) {
    case 'queue_log':
      for (const [epoch, uniqueId, queueName, channel, eventType, param1, param2, param3] of events.map(e => e.split('|'))) {
        allparams = { epoch, uniqueId, queueName, channel, eventType, param1, param2, param3 };
        if (monitorCatalog[filename][eventType]) {
          await request.post(
            {
              headers : { 'Content-type' : 'application/json' },
              uri: slackWH,
              form : {
                payload: JSON.stringify({
                  username: 'Phones',
                  icon_emoji: ':phone:',
                  text: monitorCatalog[filename][eventType].text(allparams),
                })
              }
            },
          );
        }
      }
    break;
  }
}

console.log(`Watching ${logsPath} for changes`);
fs.watch(logsPath, async (eventType, filename) => {
  if (filename && monitorCatalog[filename]) {
    console.log(`${filename} ${eventType}`);
    const fromTail = await execPromise(`tail ${logsPath}/${filename}`)
    processEvents({filename, events: arr_diff(fileStatus[filename], fromTail)});
    fileStatus[filename] = fromTail
  }
});

const initialRun = () => {
  Object.keys(fileStatus).forEach(async filename => {
    fileStatus[filename] = await execPromise(`tail ${logsPath}/${filename}`);
  })
}

initialRun()
