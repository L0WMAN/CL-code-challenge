/**
 * Web proxy to inspect, handle, and log HTTP requests and then forward them to a backend service.  
 * In the current configuration the proxy runs on port 3000 and forwards requests to the
 * back end on port 3030. 
 */

const http = require('http');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

//Create logger and specify outputs
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: 'requests.log',
      level: 'info'
    }),
    new winston.transports.File({
      filename: 'errors.log',
      level: 'error'
    })
  ]
});

//This proxy location
const hostname = '127.0.0.1';
const port = 3000;

//Outside of main function to save state
let previousRequestBody;

const proxy = http.createServer(async (req, res) => {
  //Fetch body content from request stream
  const requestBody = await getBodyContent(req);

  //Generate a uuid and log each request
  const requestID = uuidv4();
  logger.log('info', `${req.method} REQUEST: ${requestID} ${requestBody} to ${req.headers.host} at ${new Date().toISOString()}.`);
  
  //Reject with a 401 status code if request body contains filtered string  
  const filteredString = 'bad_message';
  if (handleBadMessageReply(res, requestBody, filteredString) === true) {
    logger.error(`${req.method} REQUEST: ${requestID} rejected with ${res.statusCode}: bad_message at ${new Date().toISOString()}`)
    return;
  } 
  
  //If body content of two sequential requests are the same delay the response by 2 seconds
  if(isRequestBodyEqual(previousRequestBody, requestBody) === true) {
    await delayResponse(2000);
  }
  //Setting request body content for check during next request
  previousRequestBody = setPreviousResponse(previousRequestBody, requestBody);

  //Backend HTTP request parameters
  const options = {
    hostname: '127.0.0.1',
    port: 3030,
    method: req.method,
    headers: req.headers
  };

  //Pipe incoming request to backend.  Append proxy request ID header to the response and pipe
  //that response back to the client.
  try{
    const backendReq = await http.request(options, (backendRes) => {
      res.setHeader('x-proxy-request-id', requestID);
      backendRes.pipe(res);
    });
    backendReq.write(requestBody);
    req.pipe(backendReq);
  } catch (error){
    logger.error(`Error piping request: ${error}`);
  }
});


proxy.listen(port, hostname, () => {
  logger.log('info', `Proxy running at http://${hostname}:${port}/`);
});


//Build the request body--concatenates the incoming stream of bytes and converts to a string.
const getBodyContent = async req => {
  try{
    let requestBody = [];
    for await (const chunk of req) {
      requestBody.push(chunk);
    }
    const messageBody = await Buffer.concat(requestBody).toString();
    return messageBody;  
  } catch (err){
      logger.error(`Error getting message body: ${err}`);
  }
};

const delayResponse = async time => {
  try{
    await new Promise((resolve) => {
      setTimeout(resolve, time)
    });
  } catch (err){
    logger.error(`error after timeout: ${req.method} ${requestID} ${err}`);
  }
};

const handleBadMessageRequest = (requestBody, filteredString) => {
  if (requestBody.includes(filteredString)) {
    return true;
  } else
  return false;
};

//
const handleBadMessageReply = (res, requestBody, filteredString) => {
  let badMessage = handleBadMessageRequest(requestBody, filteredString);
  if (badMessage === true) {
    res.statusCode = 401;
    res.end();
    return true
  } else
  return false;
};

const isRequestBodyEqual = (previous, current) => {
  if (previous === current) {
    return true;
  }
  return false;
}

//Used in checking for duplicate responses.  Returns undefined if the request has 
//no body to prevent false duplicates.
const setPreviousResponse = (previous, current) => {
  if (!isRequestBodyEqual(previous, current)) {
    if (current !== "") {
      return current;
    }
  }
  return undefined;
}
