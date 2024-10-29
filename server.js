// server.js
const express = require('express');
const axios = require('axios');
require('dotenv').config();

// Initialize express app
const app = express();

// Middleware
app.use(express.static('public'));
app.use(express.json());

// API Configuration
const AMADEUS_ENDPOINTS = {
    PRODUCTION: 'https://api.amadeus.com',
    TEST: 'https://test.api.amadeus.com'
};

const config = {
    isProduction: process.env.NODE_ENV === 'production',
    apiEndpoint: process.env.NODE_ENV === 'production' 
        ? AMADEUS_ENDPOINTS.PRODUCTION 
        : AMADEUS_ENDPOINTS.TEST,
    credentials: {
        apiKey: process.env.NODE_ENV === 'production'
            ? process.env.AMADEUS_PROD_API_KEY
            : process.env.AMADEUS_API_KEY,
        apiSecret: process.env.NODE_ENV === 'production'
            ? process.env.AMADEUS_PROD_API_SECRET
            : process.env.AMADEUS_API_SECRET
    }
};

// City configuration
const CITIES = {
    'amsterdam': {
        code: 'AMS',
        name: 'Amsterdam',
        country: 'Netherlands',
        districts: [
            { name: 'City Center', code: 'AMS' },
            { name: 'Museum Quarter', code: 'AMS' },
            { name: 'Canal Ring', code: 'AMS' },
            { name: 'Jordaan', code: 'AMS' },
            { name: 'De Pijp', code: 'AMS' }
        ]
    }
};

// Token management
let tokenCache = {
    token: null,
    expiresAt: null
};

async function getAccessToken() {
    try {
        if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) {
            return tokenCache.token;
        }

        console.log('Getting new access token...');
        const tokenUrl = `${config.apiEndpoint}/v1/security/oauth2/token`;
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', config.credentials.apiKey);
        params.append('client_secret', config.credentials.apiSecret);

        const response = await axios.post(tokenUrl, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        tokenCache = {
            token: response.data.access_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        };

        console.log('New access token obtained');
        return tokenCache.token;
    } catch (error) {
        console.error('Token Error:', error.response?.data || error.message);
        throw new Error('Failed to get access token');
    }
}

// Location search endpoint
app.get('/api/v1/locations/search', async (req, res) => {
    try {
        const { keyword } = req.query;
        console.log('Searching locations with keyword:', keyword);

        if (!keyword || keyword.length < 2) {
            return res.json([]);
        }

        // Check predefined cities
        const lowercaseKeyword = keyword.toLowerCase();
        const matchedCity = Object.entries(CITIES).find(([key]) => 
            key.includes(lowercaseKeyword)
        );

        if (matchedCity) {
            const [_, cityData] = matchedCity;
            return res.json([{
                name: cityData.name,
                cityName: cityData.name,
                country: cityData.country,
                cityCode: cityData.code,
                districts: cityData.districts
            }]);
        }

        // If not a predefined city, search Amadeus API
        const accessToken = await getAccessToken();
        
        const response = await axios.get(
            `${config.apiEndpoint}/v1/reference-data/locations`, {
            params: {
                keyword: keyword,
                subType: 'CITY',
                'page[limit]': 10
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const locations = response.data.data
            .filter(location => location.subType === 'CITY')
            .map(location => ({
                name: location.name,
                cityName: location.address?.cityName || location.name,
                country: location.address?.countryName,
                cityCode: location.iataCode
            }));

        console.log(`Found ${locations.length} locations matching "${keyword}"`);
        res.json(locations);

    } catch (error) {
        console.error('Location search error:', error.response?.data || error);
        res.json([]);
    }
});

// Hotel search endpoint
app.post('/api/v1/hotels/search', async (req, res) => {
    try {
        const { location, checkIn, checkOut, adults, priceRange, ratings, sortBy, page = 1 } = req.body;
        
        console.log('Received search request:', req.body);

        if (!checkIn || !checkOut || !adults) {
            return res.status(400).json({
                error: 'Missing required parameters',
                code: 'INVALID_INPUT'
            });
        }

        const accessToken = await getAccessToken();

        // Use cityCode from location data
        const cityCode = location.cityCode || location.name?.slice(0, 3).toUpperCase() || 'AMS';

        // Search parameters for v3 endpoint
        const searchParams = {
            cityCode: cityCode,
            roomQuantity: 1,
            adults: parseInt(adults),
            checkInDate: checkIn,
            checkOutDate: checkOut,
            priceRange: priceRange ? `${priceRange.min}-${priceRange.max}` : undefined,
            currency: 'EUR',
            ratings: ratings ? ratings.join(',') : undefined,
            bestRateOnly: true,
            radius: 50,
            radiusUnit: 'KM',
            hotelSource: 'ALL',
            lang: 'EN'
        };

        console.log('Searching with parameters:', searchParams);

        const response = await axios.get(
            `${config.apiEndpoint}/v3/shopping/hotel-offers`, {
            params: searchParams,
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        let hotels = response.data.data || [];
        console.log(`Found ${hotels.length} hotels before filtering`);

        // Apply sorting
        if (sortBy) {
            switch (sortBy) {
                case 'price-asc':
                    hotels.sort((a, b) => 
                        parseFloat(a.offers?.[0]?.price?.total || 0) - 
                        parseFloat(b.offers?.[0]?.price?.total || 0)
                    );
                    break;
                case 'price-desc':
                    hotels.sort((a, b) => 
                        parseFloat(b.offers?.[0]?.price?.total || 0) - 
                        parseFloat(a.offers?.[0]?.price?.total || 0)
                    );
                    break;
                case 'rating-desc':
                    hotels.sort((a, b) => 
                        (parseInt(b.hotel?.rating) || 0) - (parseInt(a.hotel?.rating) || 0)
                    );
                    break;
            }
        }

        // Apply pagination
        const itemsPerPage = 10;
        const startIndex = (page - 1) * itemsPerPage;
        const paginatedHotels = hotels.slice(startIndex, startIndex + itemsPerPage);

        console.log(`Returning ${paginatedHotels.length} hotels for page ${page}`);

        res.json({
            data: paginatedHotels,
            pagination: {
                page: parseInt(page),
                totalPages: Math.ceil(hotels.length / itemsPerPage),
                totalResults: hotels.length
            }
        });

    } catch (error) {
        console.error('Detailed API Error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            endpoint: error.config?.url,
            params: error.config?.params
        });

        if (error.response?.status === 401) {
            tokenCache = { token: null, expiresAt: null };
            return res.status(401).json({
                error: 'Authentication failed. Please try again.',
                code: 'AUTH_ERROR'
            });
        }

        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch hotel offers',
            details: error.response?.data?.errors?.[0]?.detail || error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Using API endpoint:', config.apiEndpoint);
});
