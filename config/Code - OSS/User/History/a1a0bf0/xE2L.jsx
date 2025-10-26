import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assets } from '../assets/assets';
import Loader from '../components/Loader';
import { useAppContext } from '../context/AppContext';
import toast from 'react-hot-toast';
import { motion } from 'motion/react';
import PaymentModal from '../components/PaymentModal';

const CarDetails = () => {
  const { id } = useParams();
  const { cars, axios, pickupDate, setPickupDate, returnDate, setReturnDate } =
    useAppContext();
  const navigate = useNavigate();
  const [car, setCar] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [bookingData, setBookingData] = useState(null);
  const currency = import.meta.env.VITE_CURRENCY;

  const calculateDays = () => {
    if (!pickupDate || !returnDate) return 0;
    const pickup = new Date(pickupDate);
    const returnD = new Date(returnDate);
    const diffTime = Math.abs(returnD - pickup);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays || 1;
  };

  const calculateTotalPrice = () => {
    if (!car) return 0;
    return car.pricePerDay * calculateDays();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate dates
    if (!pickupDate || !returnDate) {
      toast.error('Please select both pickup and return dates');
      return;
    }

    if (new Date(returnDate) <= new Date(pickupDate)) {
      toast.error('Return date must be after pickup date');
      return;
    }

    // Prepare booking data and show payment modal
    const booking = {
      carName: `${car.brand} ${car.model}`,
      days: calculateDays(),
      totalPrice: calculateTotalPrice(),
      currency: currency,
    };

    setBookingData(booking);
    setShowPaymentModal(true);
  };

  const handlePaymentSuccess = async () => {
    try {
      const { data } = await axios.post('/api/bookings/create', {
        car: id,
        pickupDate,
        returnDate,
      });

      if (data.success) {
        toast.success(data.message);
        setShowPaymentModal(false);
        navigate('/my-bookings');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.message);
    }
  };

  useEffect(() => {
    setCar(cars.find((car) => car._id === id));
  }, [cars, id]);

  return car ? (
    <div className="min-h-screen py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-gray-50 to-white">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-7xl mx-auto"
      >
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <img src={assets.arrow_left} alt="" className="w-5" />
          <span>Back</span>
        </button>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Car Image */}
          <div className="relative">
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5 }}
              src={car.image}
              alt={`${car.brand} ${car.model}`}
              className="w-full rounded-2xl shadow-2xl"
            />
            <div className="absolute top-4 right-4 bg-white px-4 py-2 rounded-full shadow-lg">
              <span className="text-sm font-semibold text-gray-700">
                {car.available ? '✓ Available' : '✗ Unavailable'}
              </span>
            </div>
          </div>

          {/* Car Details */}
          <div>
            <div className="mb-4">
              <span className="text-sm font-semibold text-blue-600 uppercase tracking-wider">
                {car.category} • {car.year}
              </span>
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              {car.brand} {car.model}
            </h1>
            <p className="text-gray-600 mb-6 leading-relaxed">{car.description}</p>

            {/* Price */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-2xl mb-8">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-gray-900">
                  {currency}
                  {car.pricePerDay}
                </span>
                <span className="text-gray-600">per day</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                No credit card required to reserve
              </p>
            </div>

            {/* Booking Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Pick-up Date
                  </label>
                  <input
                    type="date"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Return Date
                  </label>
                  <input
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    min={pickupDate || new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
              </div>

              {/* Price Calculation */}
              {pickupDate && returnDate && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gray-50 p-4 rounded-xl"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-600">Rental Days</span>
                    <span className="font-semibold">{calculateDays()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Total Price</span>
                    <span className="text-2xl font-bold text-blue-600">
                      {currency}
                      {calculateTotalPrice()}
                    </span>
                  </div>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={!car.available}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-semibold text-lg hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
              >
                {car.available ? 'Book Now' : 'Currently Unavailable'}
              </button>
            </form>

            {/* Additional Info */}
            <div className="mt-8 grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600 mb-1">Location</p>
                <p className="font-semibold text-gray-900">{car.location}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600 mb-1">Fuel Type</p>
                <p className="font-semibold text-gray-900">{car.fuelType || 'Petrol'}</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Payment Modal */}
      {showPaymentModal && bookingData && (
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          bookingDetails={bookingData}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  ) : (
    <Loader />
  );
};

export default CarDetails;
