dop.core.transport = function Transport(socket, close) {
    // Inherit emitter
    dop.util.merge(this, new dop.util.emitter())
    this.socket = socket
    this.close = close
    this.nodesBySocket = dop.util.map()
    this.nodesByToken = dop.data.node
}

dop.core.transport.prototype.onOpen = function(
    socket,
    sendSocket,
    closeSocket
) {
    var node = new dop.core.node(this)
    this.updateSocket(node, socket, sendSocket, closeSocket)
    sendSocket(node.token_local)
}

dop.core.transport.prototype.onMessage = function(socket, message) {
    var node = this.nodesBySocket.get(socket)
    // console.log((dop.env === 'CLIENT') + 0, dop.env, node.status, message)
    // We use this functions to separate the logic a bit and make it cleaner
    if (node.status === dop.cons.NODE_STATE_CONNECTED)
        this.onMessageCONNECTED(node, message)
    else if (node.status === dop.cons.NODE_STATE_OPEN)
        this.onMessageOPEN(node, message, socket)
    else if (node.status === dop.cons.NODE_STATE_PRECONNECTED)
        this.onMessagePRECONNECTED(node, message, socket)
    else if (node.status === dop.cons.NODE_STATE_RECONNECTING)
        this.onMessageRECONNECTING(node, message, socket)
}

dop.core.transport.prototype.onReconnect = function(
    old_socket,
    socket,
    sendSocket,
    closeSocket
) {
    // Getting original node
    var node = this.nodesBySocket.get(old_socket)
    dop.util.invariant(
        node.status === dop.cons.NODE_STATE_RECONNECTING,
        'You are trying to reconnect a socket/node that is not reconnecting'
    )
    // Removing the closed socket
    this.nodesBySocket.delete(old_socket)
    // Updating the new socket to the node
    this.updateSocket(node, socket, sendSocket, closeSocket)
    // Sending token as instruction to reconnect
    node.sendSocket(node.token)
}

dop.core.transport.prototype.onClose = function(socket) {
    var node = this.nodesBySocket.get(socket)
    // If node is undefined is because we already removed the linked socket inside of disconnectAndDelete()
    if (node !== undefined && node.status === dop.cons.NODE_STATE_CONNECTED) {
        node.status = dop.cons.NODE_STATE_RECONNECTING
        node.closedAt = Date.now()
    }
}

dop.core.transport.prototype.onError = function(socket, error) {
    var node = this.nodesBySocket.get(socket)
    if (node !== undefined) {
        node.emit(dop.cons.EVENT_ERROR, error)
    }
    this.emit(dop.cons.EVENT_ERROR, node || socket, error)
}

dop.core.transport.prototype.onDisconnect = function(node) {
    if (node.status === dop.cons.NODE_STATE_CONNECTED) {
        // Sending token as instruccion to disconnect
        node.sendSocket(node.token)
        this.disconnectAndDelete(node)
    } else if (node.status === dop.cons.NODE_STATE_RECONNECTING) {
        this.disconnectAndDelete(node)
    }
}

/////// PRIVATE
/////// PRIVATE
/////// PRIVATE

// dop.core.transport.prototype.makeInstruction = function(instruction, token) {
//     return instruction + dop.cons.CONNECTIVITY_CHARACTER + token
// }

dop.core.transport.prototype.disconnectAndDelete = function(node) {
    // Closing socket
    if (node.status !== dop.cons.NODE_STATE_PRECONNECTED) {
        node.closeSocket()
    }
    // Deleting everything
    this.nodesBySocket.delete(node.socket)
    dop.core.unregisterNode(node)
    // Emitting
    node.status = dop.cons.NODE_STATE_DISCONNECTED
    node.emit(dop.cons.EVENT_DISCONNECT)
    this.emit(dop.cons.EVENT_DISCONNECT, node)
}

dop.core.transport.prototype.updateSocket = function(
    node,
    socket,
    sendSocket,
    closeSocket
) {
    node.socket = socket
    node.sendSocket = sendSocket
    node.closeSocket = closeSocket
    this.nodesBySocket.set(socket, node)
}

dop.core.transport.prototype.sendQueue = function(node) {
    while (node.sends_queue.length > 0)
        node.sendSocket(node.sends_queue.shift())
}

dop.core.transport.prototype.getUniqueToken = function(token1, token2) {
    var t1l = token1.length
    var t2l = token2.length
    if (t1l < t2l) {
        token2 = token2.substr(t1l / 2, t1l)
    } else if (t1l > t2l) {
        token1 = token1.substr(t2l / 2, t2l)
    }
    return token1 < token2 ? token1 + token2 : token2 + token1
}

dop.core.transport.prototype.onMessageCONNECTED = function(node, message) {
    // DISCONNECT
    if (node.token === message) {
        this.disconnectAndDelete(node)
    }
    // EMIT and MANAGE MESSAGE VIA dop
    else {
        this.emit('message', node, message)
        node.emit('message', message)
        dop.core.onMessage(node, message)
    }
}

dop.core.transport.prototype.onMessageOPEN = function(node, message, socket) {
    var old_node = this.nodesByToken[message]
    // PRECONNECT
    if (old_node === undefined) {
        node.status = dop.cons.NODE_STATE_PRECONNECTED
        node.token_remote = message
        node.sendSocket(node.token_local)
    }
    // RECONNECT as remote instruction (from client the one that usually execute onReconnect)
    else if (old_node.status === dop.cons.NODE_STATE_RECONNECTING) {
        // Removing the closed socket
        var old_socket = old_node.socket
        this.nodesBySocket.delete(old_socket)
        // Updating the new socket to the old node
        this.updateSocket(old_node, socket, node.sendSocket, node.closeSocket)
        // Emitting
        old_node.status = dop.cons.NODE_STATE_CONNECTED
        old_node.emit(dop.cons.EVENT_RECONNECT)
        this.emit(dop.cons.EVENT_RECONNECT, old_node)
        // Sending the old_node token means is an instruction to reconnect on the other side
        old_node.sendSocket(old_node.token)
        this.sendQueue(old_node)
    } else {
        // This could happen if a new node is trying to connect
        // with a token that is already used by another node.
        // So we must force the disconnection of the socket/node.
        node.disconnect()
    }
}

dop.core.transport.prototype.onMessagePRECONNECTED = function(
    node,
    message,
    socket
) {
    // CONNECT
    if (node.token_remote === message) {
        node.status = dop.cons.NODE_STATE_CONNECTED
        node.token = this.getUniqueToken(node.token_local, node.token_remote)
        this.nodesByToken[node.token] = node
        this.emit(dop.cons.EVENT_CONNECT, node)
        this.sendQueue(node)
    }
    // RECONNECTED! (Means that server have't removed the token yet and can be restored)
    else if (node.token === message) {
        node.status = dop.cons.NODE_STATE_CONNECTED
        node.emit(dop.cons.EVENT_RECONNECT)
        this.emit(dop.cons.EVENT_RECONNECT, node)
        this.sendQueue(node)
    }
    // NEW CONNECTION BECAUSE onReconnect COULDN'T RECONNECT
    else if (node.token_preremote === message) {
        // Removing and emitting disconnection of the old node
        var old_node = node
        this.disconnectAndDelete(old_node)
        // Creating a new node
        node = new dop.core.node(this)
        node.status = dop.cons.NODE_STATE_CONNECTED
        node.token_local = old_node.token
        node.token_remote = old_node.token_preremote
        node.token = this.getUniqueToken(node.token_local, node.token_remote)
        this.nodesByToken[node.token] = node
        this.nodesBySocket.set(socket, node)
        this.updateSocket(
            node,
            socket,
            old_node.sendSocket,
            old_node.closeSocket
        )
        this.emit(dop.cons.EVENT_CONNECT, node)
        node.sendSocket(node.token_local)
        this.sendQueue(old_node)
    }
}

dop.core.transport.prototype.onMessageRECONNECTING = function(
    node,
    message,
    socket
) {
    // SERVER SENDS THEIR NEW LOCAL_TOKEN BECAUSE DON'T KNOW WE WANT TO RECONNECT
    node.status = dop.cons.NODE_STATE_PRECONNECTED
    node.token_preremote = message
}
