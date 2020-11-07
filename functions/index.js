const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const dateformat = require('dateformat');


exports.assignOrderNumber = functions.firestore.document('orders/{docId}').onCreate(async (snapshot, context) => {
    const id = snapshot.id;

    const ordersDocuments = await admin.firestore().collection('orders').orderBy('orderNumber', 'asc').get();
    const order = ordersDocuments.docs[ordersDocuments.docs.length - 1];
    const orderNumber = order.data().orderNumber + 1;
    console.log(orderNumber);
    await admin.firestore().collection('orders').doc(id).update({ orderNumber: orderNumber });
});

exports.solveMoney = functions.firestore.document('routes/{routeId}').onWrite(async (snapshot, context) => {
    const id = snapshot.after.id;

    const orders = snapshot.after.data().orders;
    var totalAmount = 0;
    if (snapshot.after.data().status != 'shipped') return;
    if (snapshot.after.data().called) return;
    orders.forEach(e => {
        if (e.shipped != null && e.shipped) {
            totalAmount += e.totalAccount;
        }
    });
    await admin.firestore().collection('routes').doc(id).update({
        called: true,
        totalAmount: totalAmount
    });
});

exports.assignIssue = functions.firestore.document('issues/{docId}').onCreate(async (snapshot, context) => {
    const id = snapshot.id;
    const data = snapshot.data();
    const orderId = data.orderId;
    const orderData = await admin.firestore().collection('orders').doc(orderId);

    const payload = {
        notification: {
            title: 'New Issue arises',
            body: orderData.name + '\'s order has a new Issue. Order number:' + orderData.orderNumber,
        }
    }
    await admin.messaging().sendToTopic('admin', payload);

    const issuesDocuments = await admin.firestore().collection('issues').orderBy('issueNumber').get();
    const order = issuesDocuments.docs[issuesDocuments.docs.length - 1];
    const orderNumber = order.data().issueNumber + 1;
    console.log(orderNumber);
    await admin.firestore().collection('issues').doc(id).update({ issueNumber: issueNumber });
   const orderData =await admin.firestore().collection('orders').doc(orderId).get();
   var issueCount = orderData.issueCount;
   if(orderData.issueCount == undefined||orderData.issueCount== null){

   }
    issueCount +=1;
    await admin.firestore().collection('orders').doc(orderId).update({
        issued: true,
        issueCount: issueCount,
    });
    await admin.firestore().collection('orders').doc(orderId).collection('issues').doc(id).set({
        createdDate: snapshot.data().createdDate,
        createdUser: snapshot.data().createdUser,
        description: snapshot.data().description,
        isCairo: snapshot.data().isCairo,
        isSolved: snapshot.data().isSolved,
        issueNumber: issueNumber
    });

});

exports.solveScreen = functions.firestore.document('issues/{docId}').onUpdate(async (snapshot, context) => {
    const id = snapshot.after.id
    const data = snapshot.after.data();
    const orderId = data.orderId;

    await admin.firestore().collection('orders').doc(orderId).collection('issues').doc(id).update({
        isSolved: data.isSolved,
        issueId: id,
    });

});

exports.solveIssue = functions.firestore.document('orders/{orderId}/issues/{issueId}').onUpdate(async (snapshot, ctx) => {
    const data = snapshot.after.data();
    if (data.isSolved) {
        const issueDocId = data.issueId;
        await admin.firestore().collection('issues').doc(issueDocId).update({ isSolved: true });
        var didSolved = true;
        const issuesDocuments = await admin.firestore().collection('orders').doc(ctx.params.orderId).collection('issues').get();
        issuesDocuments.forEach(documentSnaphot => {
            const isSolved = documentSnaphot.data().isSolved;
            if (didSolved && isSolved) return;
            didSolved = false;
        });
        if (didSolved) await admin.firestore().collection('orders').doc(ctx.params.orderId).update({
            issued: false,
        })
    }
});


exports.collectRoutes = functions.firestore.document('routes/{docId}').onUpdate(async (snapshot, ctx) => {
    const routeData = snapshot.after.data();

    if (routeData.status != 'collected') return;

    const orders = routeData.orders
    for (var i = 0; i < orders.length; i++) {
        if (!orders[i].shipped) return;

        const docId = orders[i].docId;
        console.log(docId);

        const returned = await admin.firestore().collection('orders').doc(docId).update({ 'status': 'collected' });
        console.log(returned);
    }
});

exports.searchRoute = functions.firestore.document('orders/{orderId}').onUpdate(async (snapshot, ctx) => {
    const dataA = snapshot.before.data();
    const dataB = snapshot.after.data();

    if (!dataA.returned && dataB.returned) {
        const payload = {
            notification: {
                title: 'Order Returned',
                body: dataB.name + '\'s order is returned to the warehouse. Order number:' + dataB.orderNumber,
            }
        }
        await admin.messaging().sendToTopic('admin', payload);

    }
    if (dataB.status != 'onDistribution' || !dataB.isCairo || dataB.routeId != null) return;

    const routesData = await admin.firestore().collection('routes').where('status', '==', 'new').get();
    var isDone = false;
    routesData.docs.forEach((routeDoc, index) => {
        if (isDone) return;
        routeDoc.data().orders.forEach((order, index) => {
            if (isDone) return;
            if (order.docId == snapshot.after.id) {
                snapshot.after.ref.update({ routeId: routeDoc.id });
                isDone = true;
                return;
            }
        })
    });
})

exports.searchRoute = functions.firestore.document('orders/{orderId}').onUpdate(async (snapshot, ctx) => {
    const dataA = snapshot.before.data();
    const dataB = snapshot.after.data();
    if (!dataB.isCairo || (dataA.routeId == null && dataB.routeId != null) || dataB.routeId == null) return;

    const routeId = dataB.routeId;

    const newOrderData = { address: dataB.address, name: dataB.name, totalAccount: dataB.totalAccount, docId: snapshot.after.id };

    const routeData = await admin.firestore().collection('routes').doc(routeId).get();

    if (!routeData.exists) return;

    const orders = routeData.data().orders;

    var finalOrders = [];
    orders.forEach((item, index) => {
        if (item.docId != snapshot.after.id) {
            finalOrders.push(item);
        }
    })


    await routeData.ref.update({ orders: newOrderData });
    console.log('Order in route has been updated');


})

exports.notifyRoute = functions.firestore.document('routes/{docId}').onCreate(async (snapshot, ctx) => {
    const routeData = snapshot.data();
    const payload = {
        notification: {
            title: routeData.createdBy + ' create a Route',
            body: routeData.name + ' has a new Route. For Area:' + routeData.area,
        }
    }
    await admin.messaging().sendToTopic('admin', payload);
})

exports.notifyTotal = functions.pubsub.schedule('every 1 minutes').onRun(async ctx => {
    const dateTime = Date.now();
    const dateFormater = dateFormat(dateTime,'m/d/yyyy');
    console.log(dateFormater)
    const routeData = await admin.firestore().collection('routes').where('createdAt',date).get();
    const orderData = await admin.firestore().collection('orders').where('createdAt',date).get();

    const routePayload = {
        notification: {
            title: 'Total Routes',
            body: 'The Total new Routes of this day in the System ' + routeData.docs.length + ' routes,now'
        }
    }
    await admin.messaging().sendToTopic('admin', routePayload);

    const orderPayload = {
        notification: {
            title: 'Total Orders',
            body: 'The Total new Orders of this day in System ' + orderData.docs.length + ' orders,now'
        }
    }
    await admin.messaging().sendToTopic('admin', orderPayload);

})