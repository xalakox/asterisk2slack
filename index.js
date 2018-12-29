
const fs = require('fs');
const request = require('request-promise-native');
const moment = require('moment')
const exec = require('child_process').exec;
const { BloomFilter } = require('bloom-filters');

const logsPath = process.env.LOGSPATH || '/var/log/asterisk';
const slackWH = process.env.SLACK_WEBHOOK;
const testMode = Boolean(process.env.TESTMODE);

if (testMode) console.log('running in test mode');

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

const onlyUnique = (value, index, self) =>{ 
  return self.indexOf(value) === index;
}

const execPromise = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
          reject(error);
          return;
      }
        resolve(stdout.trim().split('\n').filter(e => e.length>0).filter(onlyUnique));
    });
  });
}
const processEvents = async ({filename, events}) => {
  if (events.length == 0) return;
  switch (filename) {
    case 'queue_log':
      for (const [epoch, uniqueId, queueName, channel, eventType, param1, param2, param3] of events.filter(e => e.length>0).map(e => e.split('|'))) {
        allparams = { epoch, uniqueId, queueName, channel, eventType, param1, param2, param3 };
        if (monitorCatalog[filename][eventType]) {
          const payload = {
            username: 'Phones',
            icon_emoji: ':phone:',
            text: monitorCatalog[filename][eventType].text(allparams),
          };
          if (!testMode) {
            await request.post({
              headers : { 'Content-type' : 'application/json' },
              uri: slackWH,
              form : {
                payload: JSON.stringify(payload)
              }
            });
          } else {
            console.log({ payload })
          }
        }
      }
    break;
  }
}

const startWatching = () => {
  console.log(`Watching ${logsPath} for changes`);
  fs.watch(logsPath, async (eventType, filename) => {
    if (filename && monitorCatalog[filename]) {
      console.log(`${filename} ${eventType}`);
      const fromTail = await execPromise(`tail ${logsPath}/${filename}`)
      const events = fromTail.filter(e => !fileStatus[filename].has(e));
      await processEvents({filename, events });
      fromTail.forEach(e => fileStatus[filename].add(e))
    }
  });
}

const initialRun = async () => {
  for (const filename of Object.keys(fileStatus)){
    fileStatus[filename] = new BloomFilter(1e3, 0.01);
    const initialValues = await execPromise(`tail ${logsPath}/${filename}`);
    initialValues.forEach(e => fileStatus[filename].add(e));
  }
}

initialRun().then(startWatching);
